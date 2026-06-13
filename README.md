# Nolto — Claude Code Plugin

Claude Code から Nolto の MCP サーバーに接続し、プランの登録・フェーズ進捗の報告・ステータスの確認をスキルで操作できる公式プラグインです。

このプラグインは以下を一括でインストールします:

- **MCP サーバー設定** (`https://nolto.app/mcp` への HTTP 接続)
- **3 つのスキル** (`register-plan` / `report-progress` / `plan-status`)

v0.2.0 では **Stop フック**による自動進捗フラッシュが追加されました。

---

## インストール

### 1. マーケットプレイスを登録する

```
/plugin marketplace add uruca-kk/nolto-plugin
```

### 2. プラグインをインストールする

```
/plugin install nolto@nolto
```

または CLI から:

```bash
claude plugin install nolto@nolto --scope project
```

---

## 初回 OAuth 認証

インストール後、最初に MCP ツールを呼び出すと（例:「Nolto のプロジェクト一覧を見せて」）、ブラウザが自動的に開いて OAuth 2.1 + PKCE の同意画面が表示されます。承認するとトークンが Claude Code に保存され、以降は自動的に認証されます。

---

## ヘッドレス / CI 環境

SSH リモートやコンテナなど、ブラウザを開けない環境では Personal API Token を使ってください。

1. [設定 > API トークン](https://nolto.app/settings/tokens) でトークンを発行します。
2. プロジェクトの `.mcp.json` またはシェルの設定ファイルに環境変数として設定します:

```json
{
  "mcpServers": {
    "nolto": {
      "type": "http",
      "url": "https://nolto.app/mcp",
      "headers": { "Authorization": "Bearer ${NOLTO_MCP_TOKEN}" }
    }
  }
}
```

> **セキュリティ上の注意**: Personal API Token は `mcp:read` と `mcp:write` の両スコープを持ちます。パスワードと同様に扱い、**ソースコードにトークンを直書きしないでください**。CI やコンテナではシークレットマネージャーに保管し、環境変数経由で渡してください。

CLI ツール ([`@nolto/cli`](https://www.npmjs.com/package/@nolto/cli)) も CI パイプラインに適しています:

```bash
npm install -g @nolto/cli
nolto init
```

---

## スキルの使い方

### register-plan — プランを登録する

ローカルのマークダウンファイルを Nolto に登録します。H1 がプランタイトル、H2 が各フェーズとして自動抽出されます。

```
> implementation_plan.md を Nolto に登録して
```

Claude がファイルを読み込み、タイトル・フェーズを抽出して `mcp__nolto__register_plan` を呼び出します。登録後に planId と確認 URL が返されます。

### report-progress — 進捗を報告する

フェーズのステータス変更・テスト結果の記録・最終レビューの承認/差し戻しを行います。

```
> フェーズ 2 を完了にして
> テスト結果「合格」をラウンド 1 として記録して
> このプランのレビューで GO を出して
```

それぞれ `mcp__nolto__update_phase_status`、`mcp__nolto__record_phase_test_result`、`mcp__nolto__record_plan_review` が呼ばれます。

### plan-status — 状況を確認する

進行中のプランをエンジニア以外にも伝わる平易な日本語で要約します。

```
> Nolto の進行中プランを教えて
> このプランのフェーズ進捗は？
```

`mcp__nolto__list_plans` と `mcp__nolto__get_plan` を組み合わせて現在のステータスをまとめます。

---

## フック (v0.2.0+)

### 前提条件

- `@nolto/cli >= 0.2.0` が PATH 上にインストールされていること
- `NOLTO_TOKEN` 環境変数（または `nolto init` で設定したトークン）が設定されていること

### 動作フロー

Claude Code セッション中にモデルが `nolto queue <sub> <args>` を呼び出すと、進捗情報がプロジェクトの `.nolto/pending.jsonl` にオフラインで追記されます（トークン不要）。セッション終了時に Stop フック (`hooks/hooks.json`) が自動的に `nolto flush --detach` を実行します。

`nolto flush --detach` はバックグラウンドプロセスを二重フォーク（detach + unref）して即座に戻るため、Claude Code のフック待機をブロックしません。バックグラウンドワーカーがキューの各エントリを Nolto MCP サーバーに送信します。

### ノンブロッキング保証

- トークン未設定・ネットワークエラー・429 レート制限のいずれの場合も、同期ワーカーは **常に exit 0** を返します。
- エラーはプロジェクトの `.nolto/flush.log` に記録されます。キューは保持されるため、次回セッション終了時に再送が試みられます。
- Claude Code のセッションが中断されることはありません。

### ダイレクトコールとキュー版の使い分け

`report-progress` スキルによるダイレクト MCP 呼び出し（デフォルト）とキュー版は**どちらか一方**を使用してください。同じ更新に両方を使うと二重送信が発生します。

| 用途 | 方法 |
|------|------|
| 即時反映が必要 / 観測可能にしたい | `report-progress` スキル（ダイレクト呼び出し） |
| セッション終了時にまとめて送りたい | `nolto queue` + Stop フック |

---

## ライセンス

MIT — 詳細は [LICENSE](./LICENSE) を参照してください。

---

## リンク

- [Nolto 公式サイト](https://nolto.app)
- [MCP セットアップガイド](https://nolto.app/docs/guides/mcp-setup)
- [CLI ガイド](https://nolto.app/docs/guides/cli)
- [MCP ツールリファレンス](https://nolto.app/docs/reference/mcp-tools)
- [メインリポジトリ](https://github.com/uruca-kk/nolto)
