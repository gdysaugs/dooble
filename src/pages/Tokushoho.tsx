import { Link } from 'react-router-dom'
import { TopNav } from '../components/TopNav'
import './camera.css'
import './legal.css'

export function Tokushoho() {
  return (
    <div className="camera-app">
      <TopNav />
      <main className="legal-shell">
        <section className="legal-card">
          <h1>特定商取引法に基づく表記（特商法）</h1>
          <p>
            本表記は、オンライン上で提供するデジタルコンテンツ（トークン販売および生成サービス）に関する取引条件を記載したものです。
          </p>

          <div className="legal-table">
            <div className="legal-row">
              <div className="legal-key">販売事業者</div>
              <div className="legal-value">DoobleAI</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">運営統括責任者</div>
              <div className="legal-value">王喜昇</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">所在地</div>
              <div className="legal-value">東京都渋谷区道玄坂</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">電話番号</div>
              <div className="legal-value">0120010101010</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">販売URL</div>
              <div className="legal-value">https://aidooble.org</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">お問い合わせ方法</div>
              <div className="legal-value">電話または本サイトのアカウントページからの問い合わせ</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">販売価格</div>
              <div className="legal-value">各商品ページ（購入画面）に表示された金額</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">商品代金以外の必要料金</div>
              <div className="legal-value">通信料・インターネット接続費用等はお客様負担</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">販売数量・単位</div>
              <div className="legal-value">1回の決済につき、購入画面で選択したトークンプラン単位</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">申込有効期限</div>
              <div className="legal-value">決済手続き画面に表示される有効期間内</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">支払方法</div>
              <div className="legal-value">クレジットカード決済（Stripe）</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">支払時期</div>
              <div className="legal-value">購入手続き時に決済</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">商品の引渡時期</div>
              <div className="legal-value">決済完了後、通常は即時にトークンをアカウントへ反映</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">商品の引渡方法</div>
              <div className="legal-value">本サービス内アカウントへデジタルデータ（トークン）として付与</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">返品・交換・キャンセル</div>
              <div className="legal-value">
                デジタル商品の性質上、購入後の返品・返金は原則としてお受けできません。法令上の義務がある場合、または当社システム障害等で正常に付与されなかった場合はこの限りではありません。
              </div>
            </div>
            <div className="legal-row">
              <div className="legal-key">中途解約について</div>
              <div className="legal-value">
                期間課金ではありません。未使用トークンが残っている場合でも換金・払い戻しはできません。
              </div>
            </div>
            <div className="legal-row">
              <div className="legal-key">動作環境</div>
              <div className="legal-value">最新の主要ブラウザ（Chrome / Safari / Edge / Firefox）推奨</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">表現および再現性</div>
              <div className="legal-value">
                生成AIの特性上、同一条件でも出力結果には差異が生じる場合があります。
              </div>
            </div>
          </div>

          <div className="legal-links">
            <Link className="legal-link" to="/terms">
              利用規約
            </Link>
            <Link className="legal-link" to="/video">
              生成ページへ戻る
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
