# PDF 편집 도구

브라우저에서 **안전하게** PDF를 편집할 수 있는 Next.js 기반 웹 앱입니다. 업로드한 파일은 외부 서버로 전송되지 않고 전부 브라우저 내부에서만 처리됩니다.

## ✨ 기능

1. **PDF ↔ 이미지** — PDF를 페이지별 PNG/JPG로 추출하거나, 여러 이미지를 한 개의 PDF로 결합합니다. 고해상도 옵션과 ZIP 일괄 다운로드를 지원합니다.
2. **PDF 병합** — 여러 PDF를 업로드해 드래그로 순서를 조정하고 하나의 PDF로 합칩니다. 파일명/소방공무원 계급 순으로 자동 정렬하고, 병합 후 페이지 단위 편집(회전·복제·삭제·추가)도 가능합니다.
3. **PDF 분할** — PDF를 페이지별로 쪼개거나, `1-3, 5, 8-10` 같은 범위 구문으로 지정 분할합니다. 결과 파일은 개별 다운로드 또는 ZIP으로 받을 수 있습니다.
4. **PDF 회전** — 전체 페이지의 썸네일을 한눈에 보면서 개별/일괄로 90° 단위 회전을 적용하고 새 PDF로 저장합니다.
5. **PDF 마크업** — 형광펜(자유/직선), 네모박스, 텍스트, 모자이크 5가지 도구로 PDF에 표시를 남기고 저장합니다. 페이지별 Undo/Redo, 터치(모바일)와 마우스 입력 모두 지원합니다.

## 🛠 기술 스택

- **Next.js 16 (App Router, Static Export)** + **React 19**
- **TypeScript** + **Tailwind CSS v4**
- PDF 처리: [`pdf-lib`](https://pdf-lib.js.org/), [`pdfjs-dist`](https://github.com/mozilla/pdfjs-dist)
- 드래그앤드롭 정렬: [`@dnd-kit/core`](https://dndkit.com/), `@dnd-kit/sortable`
- 파일 업로드: [`react-dropzone`](https://react-dropzone.js.org/)
- 다운로드/압축: [`file-saver`](https://github.com/eligrey/FileSaver.js/), [`jszip`](https://stuk.github.io/jszip/)

## 🚀 로컬 실행

```bash
# 의존성 설치
npm install

# 개발 서버
npm run dev
```

개발 서버가 뜨면 [http://localhost:3000](http://localhost:3000)에서 앱을 확인할 수 있습니다.

정적 사이트로 빌드하려면:

```bash
npm run build
```

`out/` 디렉터리에 빌드 결과물이 생성되며, GitHub Pages 등 정적 호스팅에 그대로 배포할 수 있습니다.

## 🔒 보안 & 프라이버시

**모든 파일 처리는 100% 브라우저 내부에서만 안전하게 수행됩니다.**

- 서버로 업로드되는 파일이 없습니다. 네트워크 요청은 앱 번들/폰트 로딩 외에는 발생하지 않습니다.
- 컨텐츠 보안 정책(CSP) 메타 태그로 외부 리소스 로딩을 차단합니다.
- `pdfjs-dist` 호출 시 `isEvalSupported: false` 옵션을 강제해 eval 기반 코드 실행을 방지합니다.
- PDF/이미지 원본은 브라우저 메모리에서만 유지되며, 탭을 닫으면 즉시 사라집니다.
