import type { OcrWord } from "../ocr/types";
import type { BoundingBox } from "./types";
import {
  isLikelyChord,
  normalizeOcrText,
  parseChordSymbol,
} from "./parser";

const SECTION_PATTERN = /^(bridge|chorus|verse|intro|outro|pre-chorus|tag)\s?\d*$/i;

const CHORD_FRAGMENT =
  /^#|b$|^\/[A-G][#b]?$|^(m|maj|min|dim|aug|sus\d*|add\d*|M\d*|\d+)$/i;

interface Token {
  text: string;
  bbox: BoundingBox;
  confidence: number;
}

function wordToToken(word: OcrWord): Token | null {
  const text = normalizeOcrText(word.text);
  if (!text || SECTION_PATTERN.test(text)) return null;
  if (/[\u3131-\uD79D]/.test(text)) return null;
  if (text.length > 12) return null;
  if (!isPotentialChordPiece(text)) return null;

  return {
    text,
    bbox: {
      left: word.left,
      top: word.top,
      width: word.width,
      height: word.height,
    },
    confidence: word.confidence,
  };
}

function isPotentialChordPiece(text: string): boolean {
  if (isLikelyChord(text)) return true;
  if (CHORD_FRAGMENT.test(text)) return true;
  if (/^[A-G]$/i.test(text)) return true;
  if (text === "#" || text === "b") return true;
  if (/^sus\d*$|^maj\d*$|^min\d*$|^m\d*$|^dim\d*$|^aug\d*$/i.test(text)) {
    return true;
  }
  return false;
}

function unionBBox(a: BoundingBox, b: BoundingBox): BoundingBox {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.left + a.width, b.left + b.width);
  const bottom = Math.max(a.top + a.height, b.top + b.height);
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function horizontalOverlapOrNear(a: BoundingBox, b: BoundingBox): boolean {
  const overlap = Math.max(
    0,
    Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left),
  );
  if (overlap > 0) return true;

  const aCenter = a.left + a.width / 2;
  const bCenter = b.left + b.width / 2;
  const maxWidth = Math.max(a.width, b.width, 8);
  return Math.abs(aCenter - bCenter) <= maxWidth * 1.4;
}

function verticalGap(a: BoundingBox, b: BoundingBox): number {
  if (a.top + a.height <= b.top) return b.top - (a.top + a.height);
  if (b.top + b.height <= a.top) return a.top - (b.top + b.height);
  return 0;
}

function canClusterVertically(a: Token, b: Token): boolean {
  if (!horizontalOverlapOrNear(a.bbox, b.bbox)) return false;
  const gap = verticalGap(a.bbox, b.bbox);
  const maxH = Math.max(a.bbox.height, b.bbox.height, 10);
  return gap <= maxH * 3;
}

function findClusterRoot(parent: number[], i: number): number {
  while (parent[i] !== i) {
    parent[i] = parent[parent[i]];
    i = parent[i];
  }
  return i;
}

function clusterTokens(tokens: Token[]): Token[][] {
  const parent = tokens.map((_, i) => i);

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      if (canClusterVertically(tokens[i], tokens[j])) {
        const ri = findClusterRoot(parent, i);
        const rj = findClusterRoot(parent, j);
        if (ri !== rj) parent[rj] = ri;
      }
    }
  }

  const groups = new Map<number, Token[]>();
  for (let i = 0; i < tokens.length; i++) {
    const root = findClusterRoot(parent, i);
    const group = groups.get(root) ?? [];
    group.push(tokens[i]);
    groups.set(root, group);
  }

  return [...groups.values()].filter((g) => g.length > 0);
}

function isAccidentalNearRoot(root: BoundingBox, acc: BoundingBox): boolean {
  const rootRight = root.left + root.width;
  const horizontalClose =
    acc.left >= root.left - 4 && acc.left <= rootRight + 28;
  const verticalClose = Math.abs(acc.top - root.top) <= root.height * 2;
  return horizontalClose && verticalClose;
}

/** Build chord text from vertically stacked OCR pieces (e.g. F + # + sus4). */
function assembleChordText(tokens: Token[]): string | null {
  if (tokens.length === 0) return null;

  const joined = tokens.map((t) => t.text).join("");
  const direct = parseChordSymbol(joined);
  if (direct) return direct;

  const roots = tokens.filter((t) => /^[A-G]$/i.test(t.text));
  if (roots.length === 0) return null;

  const root = roots.sort((a, b) => a.bbox.left - b.bbox.left)[0];
  let chord = root.text.toUpperCase();
  const used = new Set<Token>([root]);

  for (const token of tokens) {
    if (used.has(token)) continue;
    if (token.text === "#" || token.text === "b") {
      if (isAccidentalNearRoot(root.bbox, token.bbox)) {
        chord += token.text;
        used.add(token);
      }
    }
  }

  const rest = tokens
    .filter((t) => !used.has(t))
    .sort((a, b) => a.bbox.top - b.bbox.top || a.bbox.left - b.bbox.left);

  for (const token of rest) {
    if (isPotentialChordPiece(token.text)) {
      chord += token.text;
      used.add(token);
    }
  }

  return parseChordSymbol(chord);
}

export function extractVerticalStackChords(
  words: OcrWord[],
): Array<{ text: string; bbox: BoundingBox; confidence: number }> {
  const tokens = words
    .map(wordToToken)
    .filter((token): token is Token => token !== null);

  const results: Array<{ text: string; bbox: BoundingBox; confidence: number }> =
    [];

  for (const group of clusterTokens(tokens)) {
    if (group.length < 2) continue;

    const text = assembleChordText(group);
    if (!text) continue;

    let bbox = group[0].bbox;
    let confidence = group[0].confidence;
    for (let i = 1; i < group.length; i++) {
      bbox = unionBBox(bbox, group[i].bbox);
      confidence = Math.min(confidence, group[i].confidence);
    }

    results.push({ text, bbox, confidence });
  }

  return results;
}
