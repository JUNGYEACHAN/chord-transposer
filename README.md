# Chord Transposer

악보 이미지(JPEG/PNG)에서 코드(화음) 기호를 OCR로 읽고, 키 변조 후 새 코드를 그려 주는 웹 앱입니다.

## 기능

- OCR.space API로 악보 이미지 텍스트 인식
- 코드 문법 하네스 (C#m, B/D#, F#sus4, Adim 등)
- 원래 키 → 목표 키 변조
- Canvas로 원래 위치에 새 코드 그리기 & PNG 다운로드
- OCR Provider 교체 가능 구조 (`lib/ocr`)

## 사전 준비

1. [OCR.space](https://ocr.space/ocrapi)에서 무료 API 키 발급
2. Node.js 18+

## 로컬 실행

```bash
cp .env.example .env.local
# .env.local 에 OCR_SPACE_API_KEY 입력

npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속

## Vercel 배포

1. GitHub에 저장소 push
2. [Vercel](https://vercel.com)에서 Import
3. Environment Variables에 `OCR_SPACE_API_KEY` 추가
4. Deploy

## 프로젝트 구조

```
app/
  api/transpose/route.ts   # OCR + 코드 추출 + 변조 API
  page.tsx                 # 메인 UI
components/
  TransposerApp.tsx        # 업로드, 키 선택, 미리보기
lib/
  chords/                  # 코드 파서, 하네스, 변조 규칙
  ocr/                     # OCR Provider (ocr-space)
```

## 제한 사항 (MVP)

- **코드(화음 기호)만** 변조합니다. 오선 음표 전체 변조는 미지원
- OCR.space 무료: 파일 1MB, 월 25,000회
- 1MB 초과 이미지는 브라우저에서 자동 리사이즈 후 업로드

## 다음 단계 (선택)

- Azure OCR Provider 추가
- Tesseract.js 브라우저 fallback
- Turso로 변조 기록 저장
