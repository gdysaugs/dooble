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
          <h1>特定商取引法に基づく表記</h1>
          <p>
            本表記は、DoobleAIがオンライン上で提供するデジタルコンテンツおよびチケット販売に関する取引条件を記載したものです。
          </p>

          <div className="legal-table">
            <div className="legal-row">
              <div className="legal-key">販売事業者</div>
              <div className="legal-value">DoobleAI</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">運営責任者</div>
              <div className="legal-value">ご請求があれば遅滞なく開示いたします。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">所在地</div>
              <div className="legal-value">ご請求があれば遅滞なく開示いたします。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">電話番号</div>
              <div className="legal-value">ご請求があれば遅滞なく開示いたします。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">販売URL</div>
              <div className="legal-value">https://aidooble.org</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">お問い合わせ方法</div>
              <div className="legal-value">サイト内のアカウントページまたはお問い合わせ導線よりご連絡ください。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">販売価格</div>
              <div className="legal-value">各商品ページまたは購入画面に表示された金額</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">商品代金以外の必要料金</div>
              <div className="legal-value">通信料、インターネット接続料金等はお客様のご負担となります。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">支払方法</div>
              <div className="legal-value">クレジットカード決済その他、購入画面に表示される決済方法</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">支払時期</div>
              <div className="legal-value">購入手続き完了時に決済されます。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">商品の引渡時期</div>
              <div className="legal-value">決済完了後、通常は即時にアカウントへチケットを付与します。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">商品の引渡方法</div>
              <div className="legal-value">本サービス内のアカウントへデジタルデータまたはチケットとして付与します。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">返品・交換・キャンセル</div>
              <div className="legal-value">
                デジタル商品の性質上、購入後のお客様都合による返品、交換、キャンセルはお受けできません。
                ただし、法令上必要な場合または当社システム障害等により正常に付与されなかった場合はこの限りではありません。
              </div>
            </div>
            <div className="legal-row">
              <div className="legal-key">動作環境</div>
              <div className="legal-value">最新版の主要ブラウザ（Chrome、Safari、Edge、Firefox）での利用を推奨します。</div>
            </div>
            <div className="legal-row">
              <div className="legal-key">表現および再現性</div>
              <div className="legal-value">
                生成AIの性質上、同一条件でも出力結果に差異が生じる場合があります。
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
