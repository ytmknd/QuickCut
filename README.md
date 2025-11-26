# QuickCut - Web Video Editor

簡易動画編集ソフト（Webアプリケーション）

## 機能

- 動画・音声・画像ファイルのインポート
- タイムライン上でのカット編集
- クリップのトリミング、移動、削除
- クリップのコピー&ペースト
- スナップ機能
- 画像の位置・スケール調整
- PNG/GIFの透過対応
- オーディオ波形表示
- ビデオサムネイル表示
- ズーム機能
- 動画エクスポート（FFmpeg.wasm使用）

## 開発環境でのセットアップ

### 必要なもの
- Node.js (npm)

### インストール手順

1. リポジトリをクローン
```bash
git clone <repository-url>
cd QuickCut
```

2. 依存パッケージをインストール
```bash
npm install
```

3. FFmpegコアファイルをコピー（初回のみ）
```bash
# Windows PowerShell
Copy-Item -Path "node_modules\@ffmpeg\core\dist\umd\*" -Destination "public\" -Recurse -Force
Copy-Item -Path "public\ffmpeg-core.js" -Destination "." -Force
Copy-Item -Path "public\ffmpeg-core.wasm" -Destination "." -Force

# Linux/Mac
cp node_modules/@ffmpeg/core/dist/umd/* public/
cp public/ffmpeg-core.* .
```

4. 開発サーバーを起動
```bash
node server.js
```

5. ブラウザで `http://localhost:3000/` を開く

**⚠️ 重要: Live Serverは使用しないでください**

FFmpeg.wasmが動作するには、特定のHTTPヘッダー（COOP/COEP）が必要です。
Live ServerやVSCodeの他の拡張機能ではこれらのヘッダーを設定できません。
必ず `node server.js` を使用してください。

## GitHub Pages等での静的ホスティング

### デプロイ手順

1. 以下のファイルをホスティングサービスにアップロード:
   - `index.html`
   - `style.css`
   - `server.js` (開発用、デプロイ不要)
   - `src/` フォルダー全体
   - `public/` フォルダー全体
   - `ffmpeg-core.js` (ルート)
   - `ffmpeg-core.wasm` (ルート)
   - `node_modules/@ffmpeg/` (FFmpegモジュール)

2. COOP/COEPヘッダーの設定
   - FFmpeg.wasmが動作するには、以下のヘッダーが必要です:
     - `Cross-Origin-Opener-Policy: same-origin`
     - `Cross-Origin-Embedder-Policy: require-corp`

3. GitHub Pagesの場合:
   - GitHub Pagesではカスタムヘッダーを設定できないため、エクスポート機能は制限される可能性があります
   - 他の編集機能（カット、トリミング、配置など）は正常に動作します

## キーボードショートカット

- **C**: クリップをカット
- **Ctrl+C / Cmd+C**: クリップをコピー
- **Ctrl+V / Cmd+V**: クリップを貼り付け
- **Delete / Backspace**: 選択したクリップを削除
- **S**: スナップ機能のオン/オフ
- **+**: タイムラインをズームイン
- **-**: タイムラインをズームアウト

## ブラウザ要件

- モダンなWebブラウザ（Chrome、Edge、Firefox推奨）
- SharedArrayBufferサポート（FFmpeg.wasm使用時に必要）

## ライセンス

MIT License

## 使用技術

- HTML5 Canvas API
- Web Audio API
- MediaRecorder API
- FFmpeg.wasm
- ES6 Modules
