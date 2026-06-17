# Nolto — Claude Code Plugin

Claude Code から Nolto の MCP サーバーに接続し、プランの登録・フェーズ進捗の報告・ステータスの確認をスキルで操作できる公式プラグインです。

このプラグインは以下を一括でインストールします:

- **MCP サーバー設定** (`https://nolto.app/mcp` への HTTP 接続)
- **4 つのスキル** (`register-plan` / `report-progress` / `plan-status` / `link-project`)

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

SSH リモートやコンテナなど、ブラウザを開けない環境では、MCP の「Authenticate」ボタン（OAuth）は完了できません（開くブラウザがありません）。代わりに以下を使ってください。

### 推奨: `nolto login`（device-code フロー）

[`@nolto/cli`](https://www.npmjs.com/package/@nolto/cli)（>= 0.3.0）の `nolto login` は、**別の端末（スマホ・ラップトップ）のブラウザ**で承認するだけのヘッドレス向け認証です。トークンの手動コピーは不要です。

```bash
npm install -g @nolto/cli
nolto login --client claude
```

表示された URL を任意の端末のブラウザで開いて承認すると、CLI が自動でトークンを取得し、`claude mcp add`（user scope）で `nolto` MCP サーバーを登録します。登録後、Claude Code を再接続すれば `nolto` ツールが使えます（プラグイン同梱の `plugin:nolto:nolto` は OAuth 前提なので、こちらの `nolto` サーバーを使ってください）。

### 代替: Personal API Token を手動で渡す

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

## リポジトリとプロジェクトの紐付け

プロジェクトをリポジトリに固定するには、リポジトリ root に `nolto.json` を作成してコミットしてください:

```json
{ "projectId": "00000000-0000-0000-0000-000000000001" }
```

CLI からワンコマンドで作成できます:

```bash
nolto link <projectId>   # nolto.json を書いてコミット案内を表示
nolto link --show        # 現在の紐付けを確認
```

`nolto.json` があると、スキル（Claude/AI ツール）は起動時にこのファイルを読み込み、すべての MCP 呼び出しで `projectId` を自動で明示します。複数のリポジトリを同一ユーザーで操作する場合でも、混在を防げます。

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

## プランテンプレート / CLAUDE.md サンプル

v0.2.1 からプラグインに **2 つのテンプレートファイル**が同梱されています:

| ファイル | 説明 |
|---|---|
| `${CLAUDE_PLUGIN_ROOT}/templates/plan-template.md` | Nolto 推奨プランテンプレート（日本語・フェーズ・ステータス例付き） |
| `${CLAUDE_PLUGIN_ROOT}/templates/CLAUDE.md.sample` | プロジェクトの `CLAUDE.md` に貼り付けるガイドラインスニペット |

### 使い方

1. `templates/CLAUDE.md.sample` の内容をプロジェクトの `CLAUDE.md` に貼り付けます。これにより、このプロジェクトで Claude がプランを作成するたびに Nolto の規則に従ったフォーマットで書かれるようになります。
2. 実際にプランを書くときは `templates/plan-template.md` を出発点にコピーして編集してください。

### プランは日本語で書く理由

Nolto の分類器パイプライン（型1 = 実装プラン）は本文をそのまま日本語ビューに表示します。英語で書くと非エンジニア向けの可視化が読みづらくなるため、プラン本文は日本語で記述してください。

### ステータスマーカーの 3 つのルール

チェックボックスによる判定は**そのセクション自身の本文**が対象です。`###` サブフェーズのチェックは親 `##` フェーズには**伝播しません**。フェーズ（`##`）のステータスは、見出しマーカーを付けるか、サブフェーズを作らず見出し直下にチェックリストを置くことで設定します。

| ステータス | 判定方法（そのセクション自身の本文） |
|---|---|
| 完了 | H2 見出しに「✅」「完了」「済」を含める、またはチェックボックスが全部 `- [x]` |
| 進行中 | H2 見出しに「進行中」「着手」を含める、または `- [x]` と `- [ ]` が混在 |
| 未着手 | チェックボックスが全部 `- [ ]`、またはチェックボックスが無い |

見出しマーカー（「✅」「進行中」など）は、見出し行または本文の最初の 1 行でのみ認識されます。深い行に書いても拾われません。

---

## フック (v0.2.0+)

### キュー送信機能はオプトイン（CLI が必要）

Stop フックによるセッション終了時の一括送信は **任意機能** です。使うには次が必要です:

- `@nolto/cli >= 0.2.0` が PATH 上にインストールされていること（`npm i -g @nolto/cli`）
- `NOLTO_TOKEN` 環境変数（または `nolto init` で設定したトークン）が設定されていること

**CLI を入れなくてもプラグイン本体（MCP ツール + スキル）は問題なく使えます。** その場合 `report-progress` スキルのダイレクト MCP 呼び出しで進捗は即時反映されます。

### 動作フロー

Claude Code セッション中にモデルが `nolto queue <sub> <args>` を呼び出すと、進捗情報がプロジェクトの `.nolto/pending.jsonl` にオフラインで追記されます。セッション終了時に Stop フック (`hooks/hooks.json`) が自動的に `nolto flush --detach` を実行します。

`nolto flush --detach` はバックグラウンドプロセスを二重フォーク（detach + unref）して即座に戻るため、Claude Code のフック待機をブロックしません。バックグラウンドワーカーがキューの各エントリを Nolto MCP サーバーに送信します。

### CLI 未インストール時の挙動（v0.2.4+）

Stop フックは `nolto` が PATH に無い場合、**エラーを出さず黙って何もしません**（always exit 0）。初回の 1 回だけ「`@nolto/cli` を入れると終了時に自動送信できる」というヒントを表示し（マシンごとに `${XDG_CONFIG_HOME:-$HOME/.config}/nolto/.cli-hint-shown` で抑制）、以降は完全に無音です。

> 旧バージョンでは `nolto` 未導入時にセッション終了ごとに `command not found`（exit 127）が「Stop hook error」として表示されていました。v0.2.4 でこのガードを追加し解消しています。

### ノンブロッキング保証

- CLI 未導入・トークン未設定・ネットワークエラー・429 レート制限のいずれの場合も、フックは **常に exit 0** を返します。
- CLI 導入後のエラーはプロジェクトの `.nolto/flush.log` に記録されます。キューは保持されるため、次回セッション終了時に再送が試みられます。
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
