# Chord Transposer

악보 이미지(JPEG/PNG)에서 코드(화음) 기호를 OCR로 읽고, 키 변조 후 새 코드를 그려 주는 웹 앱입니다.

## 기능

- OCR.space API로 악보 이미지 텍스트 인식
- 코드 문법 하네스 (C#m, B/D#, F#sus4, Adim 등)
- 원래 키 → 목표 키 변조
- Canvas로 원래 위치에 새 코드 그리기 & PNG 다운로드
- **원본·결과 나란히 대조** 및 코드 수정 UI
- **Turso**에 수정 내용 저장 (OCR 학습 데이터 축적)
- OCR Provider 교체 가능 구조 (`lib/ocr`)

## 사전 준비

1. [OCR.space](https://ocr.space/ocrapi)에서 무료 API 키 발급
2. (선택) [Turso](https://turso.tech)에서 DB 생성 — 코드 수정 저장용
3. Node.js 18+

## 로컬 실행

```bash
cp .env.example .env.local
# .env.local 에 OCR_SPACE_API_KEY 입력
# (선택) TURSO_DATABASE_URL, TURSO_AUTH_TOKEN 입력

npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000) 접속

## Vercel 배포

1. GitHub에 저장소 push
2. [Vercel](https://vercel.com)에서 Import
3. Environment Variables 추가:
   - `OCR_SPACE_API_KEY` (필수)
   - `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` (코드 수정 저장 — 선택)
4. Deploy

## 프로젝트 구조

```
app/
  api/transpose/route.ts   # OCR + 코드 추출 + 변조 API
  api/corrections/route.ts # Turso에 수정 내용 저장
  page.tsx                 # 메인 UI
components/
  TransposerApp.tsx        # 업로드, 키 선택, 대조, 수정
  SheetComparison.tsx      # 원본·결과 나란히 보기
  ChordCorrectionPanel.tsx # 코드 수정 및 Turso 저장
lib/
  chords/                  # 코드 파서, 하네스, 변조 규칙
  db/                      # Turso 클라이언트 및 저장
  ocr/                     # OCR Provider (ocr-space)
```

## Turso 설정 (코드 수정 저장)

1. [Turso](https://turso.tech) 가입 후 Database 생성
2. CLI 또는 대시보드에서 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` 확인
3. Vercel Production 환경 변수에 추가 후 Redeploy
4. 앱에서 코드 수정 후 **「수정 내용 Turso에 저장」** 클릭

테이블은 첫 저장 시 자동 생성됩니다.

## 제한 사항 (MVP)

- **코드(화음 기호)만** 변조합니다. 오선 음표 전체 변조는 미지원
- OCR.space 무료: 파일 1MB, 월 25,000회
- 1MB 초과 이미지는 브라우저에서 자동 리사이즈 후 업로드
- Turso 미설정 시 변조·대조·수정 UI는 동작하지만 저장 API는 503 반환

## 다음 단계 (선택)

- 저장된 수정 데이터로 OCR 후처리 규칙 자동화
- Azure OCR Provider 추가
- Tesseract.js 브라우저 fallback
