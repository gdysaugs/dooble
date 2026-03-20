import { Link } from 'react-router-dom'
import { TopNav } from '../components/TopNav'
import './camera.css'
import './legal.css'

export function Terms() {
  return (
    <div className="camera-app">
      <TopNav />
      <main className="legal-shell">
        <section className="legal-card">
          <h1>利用規約</h1>
          <p>本規約は、DoobleAI（以下「当サービス」）の利用条件を定めるものです。</p>

          <h2>第1条（適用）</h2>
          <p>本規約は、当サービスの利用に関する一切の関係に適用されます。</p>

          <h2>第2条（アカウント）</h2>
          <ul className="legal-list">
            <li>ユーザーは、正確な情報でアカウントを登録するものとします。</li>
            <li>不正利用、第三者への譲渡、貸与は禁止します。</li>
          </ul>

          <h2>第3条（禁止事項）</h2>
          <ul className="legal-list">
            <li>法令または公序良俗に反する行為</li>
            <li>第三者の権利を侵害する行為</li>
            <li>サービス運営を妨害する行為</li>
          </ul>

          <h2>第4条（有料機能・トークン）</h2>
          <ul className="legal-list">
            <li>当サービスの一部機能は有料です。</li>
            <li>購入済みトークンは、法令上必要な場合を除き返金できません。</li>
          </ul>

          <h2>第5条（免責）</h2>
          <p>
            当サービスは、システム障害・通信障害等により一時的に利用できない場合があります。これにより生じた損害について、当サービスは法令上許される範囲で責任を負いません。
          </p>

          <h2>第6条（規約の変更）</h2>
          <p>当サービスは、必要に応じて本規約を変更することがあります。</p>

          <h2>第7条（準拠法・管轄）</h2>
          <p>本規約は日本法に準拠し、紛争が生じた場合は日本の裁判所を専属的合意管轄とします。</p>

          <div className="legal-links">
            <Link className="legal-link" to="/tokushoho">
              特商法ページ
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
