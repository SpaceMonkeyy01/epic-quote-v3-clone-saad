import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useInView, animate, useMotionValue, useSpring, useTransform } from 'framer-motion'

/* ============================================================
   Public landing — premium dark + gold + Inter (matches
   epiccraftings.com). Self-contained styles scoped to .ecl.
============================================================ */

const GOLD = '#f9a600'
const ease = [0.22, 1, 0.36, 1]
const fadeUp = { hidden: { opacity: 0, y: 26 }, show: { opacity: 1, y: 0 } }
const LOGO = '/quote-logo-t.png'   // current logo, white wordmark + transparent bg for dark surfaces

function Reveal({ children, delay = 0, style }) {
  return (
    <motion.div variants={fadeUp} initial="hidden" whileInView="show"
      viewport={{ once: true, margin: '-70px' }} transition={{ duration: 0.6, ease, delay }} style={style}>
      {children}
    </motion.div>
  )
}

function CountUp({ to, suffix = '' }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, margin: '-60px' })
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!inView) return
    const c = animate(0, to, { duration: 1.5, ease: 'easeOut', onUpdate: (v) => setN(Math.floor(v)) })
    return () => c.stop()
  }, [inView, to])
  return <span ref={ref}>{n.toLocaleString()}{suffix}</span>
}

// mouse-parallax 3D tilt
function Tilt({ children }) {
  const x = useMotionValue(0), y = useMotionValue(0)
  const rx = useSpring(useTransform(y, [-0.5, 0.5], [12, -12]), { stiffness: 140, damping: 14 })
  const ry = useSpring(useTransform(x, [-0.5, 0.5], [-16, 16]), { stiffness: 140, damping: 14 })
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    x.set((e.clientX - r.left) / r.width - 0.5)
    y.set((e.clientY - r.top) / r.height - 0.5)
  }
  return (
    <div style={{ perspective: 1000 }} onMouseMove={onMove} onMouseLeave={() => { x.set(0); y.set(0) }}>
      <motion.div style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}>
        <motion.div animate={{ y: [0, -12, 0] }} transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}>
          {children}
        </motion.div>
      </motion.div>
    </div>
  )
}

const Icon = ({ d, size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{d}</svg>
)
const icoLetters = <><path d="M4 7V5h16v2" /><path d="M9 19h6" /><path d="M12 5v14" /></>
const icoMonument = <><path d="M5 21V9l7-5 7 5v12" /><path d="M9 21v-6h6v6" /><path d="M3 21h18" /></>
const icoFab = <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2 2.3-2.3Z" /></>
const icoWay = <><path d="M3 7h13l3 3-3 3H3z" /><path d="M21 17H8l-3-3 3-3" /></>
const icoUpload = <><path d="M12 15V3" /><path d="m7 8 5-5 5 5" /><path d="M5 21h14" /></>
const icoSpark = <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6 6 2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></>
const icoDoc = <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /><path d="M9 13h6M9 17h6" /></>
const arrow = <Icon size={18} d={<><path d="M5 12h14" /><path d="m13 5 7 7-7 7" /></>} />

const CATS = [
  { n: 'Channel Letters', d: 'Face-lit, halo-lit, and combo — built to spec.', i: icoLetters },
  { n: 'Pylon & Monuments', d: 'Freestanding, illuminated, ground-up structures.', i: icoMonument },
  { n: 'Custom Fabrication', d: 'Routed, push-thru, cabinets, and one-offs.', i: icoFab },
  { n: 'Way Findings', d: 'Interior and exterior directional systems.', i: icoWay },
]
const STEPS = [
  { n: 'Upload the drawing', d: "Drop in the client's PDF or image — even vector CAD.", i: icoUpload },
  { n: 'AI extracts the specs', d: 'Sign type, dimensions, materials, side view — auto-filled.', i: icoSpark },
  { n: 'Send a branded proposal', d: 'Editable, on-brand, with a payment link — ready to ship.', i: icoDoc },
]
const STATS = [
  { to: 20, suffix: '+', k: 'Years in industry' },
  { to: 110, suffix: 'k+', k: 'Workshop sq.ft' },
  { to: 440, suffix: '+', k: 'Workforce' },
  { to: 250, suffix: 'k+', k: 'Signs completed' },
]
const MARQUEE = ['CHANNEL LETTERS', 'PYLON SIGNS', 'MONUMENTS', 'PUSH-THRU CABINETS', 'LED NEON', 'WAY FINDING', 'CUSTOM FABRICATION', 'HALO LIT', 'ACM BACKERS']

export default function Landing() {
  const navigate = useNavigate()
  const go = () => navigate('/login')

  return (
    <div className="ecl">
      <style>{CSS}</style>

      <header className="ecl-nav">
        <div className="ecl-wrap ecl-navbar">
          <div className="ecl-brand"><img src={LOGO} alt="Epic Craftings" /></div>
          <nav className="ecl-links">
            <a href="#products">Products</a><a href="#how">How it works</a><a href="#company">Company</a>
          </nav>
          <div className="ecl-navcta">
            <button className="ecl-ghost" onClick={go}>Client login</button>
            <button className="ecl-gold" onClick={go}>Get a quote {arrow}</button>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="ecl-hero">
        {/* full-bleed animated background — fills the side space with motion */}
        <div className="ecl-bg">
          <div className="ecl-grid" />
          <div className="ecl-aurora a1" />
          <div className="ecl-aurora a2" />
        </div>

        <div className="ecl-wrap ecl-hero-grid">
          <div className="ecl-hero-copy">
            <motion.span className="ecl-eyebrow" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>
              For wholesale sign manufacturers
            </motion.span>
            <motion.h1 className="ecl-h1" initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.65, ease, delay: 0.05 }}>
              WHOLESALE SIGNAGE,<br /><span className="g">quoted in minutes.</span>
            </motion.h1>
            <motion.p className="ecl-sub" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.15 }}>
              Upload the drawing, let AI read the specs, and send a branded, fully editable
              proposal — all in one place. Built by Epic Craftings.
            </motion.p>
            <motion.div className="ecl-herocta" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease, delay: 0.25 }}>
              <button className="ecl-gold lg" onClick={go}>Get an instant quote {arrow}</button>
              <button className="ecl-ghost lg" onClick={go}>Client login</button>
            </motion.div>
          </div>

          <motion.div className="ecl-herovis" initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.8, ease, delay: 0.2 }}>
            <Tilt>
              <div className="ecl-quote-card">
                <div className="ecl-qc-head"><img src={LOGO} alt="" /><span className="ecl-qc-id">EC100066</span></div>
                <div className="ecl-qc-row"><span>Channel Letters</span><b>$1,200</b></div>
                <div className="ecl-qc-bar"><motion.span initial={{ width: 0 }} animate={{ width: '82%' }} transition={{ duration: 1.1, ease, delay: 0.8 }} /></div>
                <div className="ecl-qc-row sm"><span>Face color</span><i className="sw black" /></div>
                <div className="ecl-qc-row sm"><span>Return &amp; trim</span><i className="sw white" /></div>
                <div className="ecl-qc-pay">Click here to make payment</div>
              </div>
            </Tilt>
          </motion.div>
        </div>
      </section>

      {/* marquee */}
      <div className="ecl-marquee">
        <div className="ecl-marquee-track">
          {[...MARQUEE, ...MARQUEE].map((m, i) => (<span key={i}>{m}<i className="dot" /></span>))}
        </div>
      </div>

      {/* stats */}
      <section className="ecl-stats">
        <div className="ecl-wrap ecl-stats-grid">
          {STATS.map((s, i) => (
            <Reveal key={s.k} delay={i * 0.08}>
              <div className="ecl-stat">
                <div className="ecl-stat-n"><CountUp to={s.to} suffix={s.suffix} /></div>
                <div className="ecl-stat-k">{s.k}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* products */}
      <section className="ecl-sec" id="products">
        <div className="ecl-wrap">
          <Reveal><div className="ecl-kicker">What we make</div></Reveal>
          <Reveal delay={0.05}><h2 className="ecl-h2">Every sign type, one workflow</h2></Reveal>
          <div className="ecl-cats">
            {CATS.map((c, i) => (
              <Reveal key={c.n} delay={i * 0.07}>
                <div className="ecl-cat">
                  <div className="ecl-cat-ico"><Icon d={c.i} /></div>
                  <div className="ecl-cat-n">{c.n}</div>
                  <div className="ecl-cat-d">{c.d}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* how */}
      <section className="ecl-sec dark" id="how">
        <div className="ecl-wrap">
          <Reveal><div className="ecl-kicker">How it works</div></Reveal>
          <Reveal delay={0.05}><h2 className="ecl-h2">Three steps to a sent proposal</h2></Reveal>
          <div className="ecl-steps">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 0.1}>
                <div className="ecl-step">
                  <div className="ecl-step-no">{String(i + 1).padStart(2, '0')}</div>
                  <div className="ecl-step-ico"><Icon d={s.i} /></div>
                  <div className="ecl-cat-n">{s.n}</div>
                  <div className="ecl-cat-d">{s.d}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* cta */}
      <section className="ecl-sec" id="company">
        <div className="ecl-wrap">
          <Reveal>
            <div className="ecl-cta">
              <div className="ecl-aurora a1" style={{ opacity: 0.4 }} />
              <h2 className="ecl-cta-h">Get instant quotes. Place orders.<br />Track delivery — all in one portal.</h2>
              <p className="ecl-cta-p">The Epic Craftings client portal puts quoting, specs, and order progress in one place.</p>
              <div className="ecl-herocta center">
                <button className="ecl-gold lg" onClick={go}>Start a quote {arrow}</button>
                <button className="ecl-ghost lg" onClick={go}>Register</button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <footer className="ecl-foot">
        <div className="ecl-wrap ecl-foot-grid">
          <div>
            <img src={LOGO} alt="Epic Craftings" className="ecl-foot-logo" />
            <p className="ecl-foot-tag">Wholesale signage, quoted fast.</p>
          </div>
          <div className="ecl-foot-col"><h4>Company</h4><a href="#company">Profile</a><a href="#products">Products</a><a href="#company">Contact</a></div>
          <div className="ecl-foot-col"><h4>Portal</h4><a onClick={go}>Client login</a><a onClick={go}>Register</a><a onClick={go}>Get a quote</a></div>
          <div className="ecl-foot-col"><h4>Quality</h4><span>UL Listed</span><span>CE Certified</span><span>3-year warranty</span></div>
        </div>
        <div className="ecl-wrap ecl-foot-bar">© {new Date().getFullYear()} Epic Craftings. All rights reserved.</div>
      </footer>
    </div>
  )
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
.ecl { --gold:${GOLD}; --bg:#0a0a0c; --bg2:#0e0e11; --panel:#15151a; --line:#23232a; --tx:#ededf0; --dim:#a8a8b2; --faint:#74747e;
  font-family:'Inter',system-ui,sans-serif; background:var(--bg); color:var(--tx); min-height:100vh; -webkit-font-smoothing:antialiased; overflow-x:hidden; }
.ecl a { color:inherit; text-decoration:none; cursor:pointer; }
.ecl .ecl-wrap { max-width:1240px; margin:0 auto; padding:0 36px; }
.ecl button { font-family:inherit; cursor:pointer; border:none; border-radius:9px; font-weight:700; display:inline-flex; align-items:center; gap:7px; transition:transform .12s, background .15s, box-shadow .15s, border-color .15s; }
.ecl .ecl-gold { background:var(--gold); color:#1a1305; padding:10px 16px; font-size:13.5px; }
.ecl .ecl-gold:hover { box-shadow:0 8px 24px rgba(249,166,0,.38); transform:translateY(-1px); }
.ecl .ecl-gold.lg, .ecl .ecl-ghost.lg { padding:12px 22px; font-size:14px; border-radius:10px; }
.ecl .ecl-ghost { background:rgba(255,255,255,.03); color:var(--tx); border:1px solid var(--line); padding:10px 16px; font-size:13.5px; }
.ecl .ecl-ghost:hover { border-color:var(--gold); color:#fff; }

.ecl-nav { position:sticky; top:0; z-index:50; background:rgba(10,10,12,.72); backdrop-filter:blur(14px); border-bottom:1px solid var(--line); }
.ecl-navbar { display:flex; align-items:center; justify-content:space-between; height:62px; }
.ecl-brand img { height:30px; display:block; }
.ecl-links { display:flex; gap:28px; font-size:13.5px; font-weight:600; color:var(--dim); }
.ecl-links a:hover { color:#fff; }
.ecl-navcta { display:flex; gap:9px; }

.ecl-hero { position:relative; padding:64px 0 54px; overflow:hidden; }
.ecl-bg { position:absolute; inset:0; z-index:0; pointer-events:none; }
.ecl-grid { position:absolute; inset:-2px; background-image:linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px);
  background-size:48px 48px; -webkit-mask-image:radial-gradient(ellipse 55% 55% at 62% 38%, #000 12%, transparent 68%); mask-image:radial-gradient(ellipse 55% 55% at 62% 38%, #000 12%, transparent 68%); animation:eclGrid 26s linear infinite; }
@keyframes eclGrid { to { background-position:48px 48px; } }
.ecl-aurora { position:absolute; border-radius:50%; filter:blur(72px); opacity:.5; }
.ecl-aurora.a1 { width:560px; height:560px; top:-180px; right:-90px; background:radial-gradient(circle,rgba(249,166,0,.42),transparent 60%); animation:eclFloat1 16s ease-in-out infinite; }
.ecl-aurora.a2 { width:440px; height:440px; bottom:-200px; left:-130px; background:radial-gradient(circle,rgba(249,166,0,.16),transparent 62%); animation:eclFloat2 20s ease-in-out infinite; }
@keyframes eclFloat1 { 0%,100%{ transform:translate(0,0) scale(1);} 50%{ transform:translate(-50px,40px) scale(1.1);} }
@keyframes eclFloat2 { 0%,100%{ transform:translate(0,0) scale(1);} 50%{ transform:translate(60px,-30px) scale(1.08);} }

.ecl-hero-grid { position:relative; z-index:1; display:grid; grid-template-columns:1.05fr .95fr; gap:48px; align-items:center; }
.ecl-eyebrow { display:inline-block; font-size:11.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--gold);
  background:rgba(249,166,0,.1); border:1px solid rgba(249,166,0,.28); border-radius:999px; padding:6px 13px; margin-bottom:18px; }
.ecl-h1 { font-size:46px; line-height:1.04; font-weight:800; letter-spacing:-.03em; margin:0 0 18px; color:#fff; }
.ecl-h1 .g { background:linear-gradient(90deg,#f9a600,#ffd166,#f9a600); background-size:200% auto; -webkit-background-clip:text; background-clip:text; color:transparent; animation:eclShimmer 4s linear infinite; }
@keyframes eclShimmer { to { background-position:200% center; } }
.ecl-sub { font-size:15.5px; line-height:1.6; color:var(--dim); max-width:460px; margin:0 0 24px; }
.ecl-herocta { display:flex; gap:11px; flex-wrap:wrap; }
.ecl-herocta.center { justify-content:center; }

.ecl-herovis { display:flex; justify-content:center; }
.ecl-quote-card { width:308px; background:linear-gradient(160deg,#1a1a20,#101015); border:1px solid #2c2c34; border-radius:16px; padding:18px;
  box-shadow:0 30px 70px rgba(0,0,0,.6), 0 0 0 1px rgba(249,166,0,.06); }
.ecl-qc-head { display:flex; align-items:center; justify-content:space-between; padding-bottom:12px; border-bottom:1px solid var(--line); margin-bottom:12px; }
.ecl-qc-head img { height:22px; }
.ecl-qc-id { font-size:11px; font-weight:800; color:var(--faint); letter-spacing:.04em; }
.ecl-qc-row { display:flex; align-items:center; justify-content:space-between; font-size:13px; color:var(--dim); margin:9px 0; }
.ecl-qc-row b { color:var(--gold); font-weight:800; font-size:15px; }
.ecl-qc-row.sm { font-size:12px; margin:7px 0; }
.ecl-qc-row .sw { width:28px; height:16px; border-radius:4px; border:1px solid #3a3a44; }
.ecl-qc-row .sw.black { background:#111; } .ecl-qc-row .sw.white { background:#fff; }
.ecl-qc-bar { height:5px; border-radius:4px; background:#26262e; overflow:hidden; margin:5px 0 3px; }
.ecl-qc-bar span { display:block; height:100%; background:var(--gold); border-radius:4px; }
.ecl-qc-pay { margin-top:13px; background:var(--gold); color:#1a1305; text-align:center; font-weight:800; font-size:12px; padding:10px; border-radius:8px; letter-spacing:.02em; }

.ecl-marquee { border-top:1px solid var(--line); border-bottom:1px solid var(--line); background:#0c0c0f; overflow:hidden; padding:12px 0; }
.ecl-marquee-track { display:flex; white-space:nowrap; width:max-content; animation:eclMarq 34s linear infinite; }
.ecl-marquee-track span { display:inline-flex; align-items:center; font-size:12px; font-weight:700; letter-spacing:.14em; color:#5c5c66; }
.ecl-marquee-track .dot { width:4px; height:4px; border-radius:50%; background:var(--gold); margin:0 26px; opacity:.7; }
@keyframes eclMarq { to { transform:translateX(-50%); } }

.ecl-stats { border-bottom:1px solid var(--line); background:var(--bg2); }
.ecl-stats-grid { display:grid; grid-template-columns:repeat(4,1fr); }
.ecl-stat { padding:28px 10px; text-align:center; border-right:1px solid var(--line); }
.ecl-stats-grid > div:last-child .ecl-stat { border-right:none; }
.ecl-stat-n { font-size:34px; font-weight:800; color:var(--gold); letter-spacing:-.02em; }
.ecl-stat-k { font-size:12px; color:var(--dim); margin-top:3px; font-weight:500; }

.ecl-sec { padding:66px 0; }
.ecl-sec.dark { background:var(--bg2); border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
.ecl-kicker { font-size:12px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--gold); margin-bottom:10px; }
.ecl-h2 { font-size:30px; font-weight:800; letter-spacing:-.025em; color:#fff; margin:0 0 30px; }
.ecl-cats { display:grid; grid-template-columns:repeat(4,1fr); gap:16px; }
.ecl-cat { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:22px 20px; height:100%; transition:transform .2s, border-color .2s, background .2s, box-shadow .2s; }
.ecl-cat:hover { transform:translateY(-5px); border-color:var(--gold); background:#181820; box-shadow:0 18px 40px rgba(0,0,0,.5); }
.ecl-cat-ico, .ecl-step-ico { width:44px; height:44px; border-radius:12px; background:rgba(249,166,0,.12); color:var(--gold); display:flex; align-items:center; justify-content:center; margin-bottom:14px; }
.ecl-cat-ico svg, .ecl-step-ico svg { width:22px; height:22px; }
.ecl-cat-n { font-size:16px; font-weight:700; color:#fff; margin-bottom:6px; }
.ecl-cat-d { font-size:13.5px; color:var(--dim); line-height:1.55; }

.ecl-steps { display:grid; grid-template-columns:repeat(3,1fr); gap:18px; }
.ecl-step { position:relative; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:24px 22px; height:100%; transition:border-color .2s, transform .2s; }
.ecl-step:hover { border-color:var(--gold); transform:translateY(-4px); }
.ecl-step-no { position:absolute; top:18px; right:20px; font-size:30px; font-weight:800; color:#202028; letter-spacing:-.02em; }

.ecl-cta { position:relative; overflow:hidden; text-align:center; background:linear-gradient(160deg,#17170d,#0e0e11); border:1px solid #2c2716; border-radius:22px; padding:52px 26px; }
.ecl-cta-h { position:relative; z-index:1; font-size:28px; font-weight:800; letter-spacing:-.02em; color:#fff; margin:0 0 12px; line-height:1.2; }
.ecl-cta-p { position:relative; z-index:1; font-size:14.5px; color:var(--dim); max-width:500px; margin:0 auto 24px; }

.ecl-foot { border-top:1px solid var(--line); background:#08080a; padding:46px 0 0; }
.ecl-foot-grid { display:grid; grid-template-columns:1.4fr 1fr 1fr 1fr; gap:28px; padding-bottom:32px; }
.ecl-foot-logo { height:30px; }
.ecl-foot-tag { color:var(--faint); font-size:13px; margin-top:11px; }
.ecl-foot-col h4 { font-size:12px; text-transform:uppercase; letter-spacing:.06em; color:#fff; margin:0 0 12px; font-weight:700; }
.ecl-foot-col a, .ecl-foot-col span { display:block; font-size:13.5px; color:var(--dim); margin-bottom:9px; }
.ecl-foot-col a:hover { color:var(--gold); }
.ecl-foot-bar { border-top:1px solid var(--line); padding:18px 0; font-size:12.5px; color:var(--faint); text-align:center; }

@media (max-width:900px) {
  .ecl-links { display:none; }
  .ecl .ecl-wrap { padding:0 20px; }
  .ecl-hero-grid { grid-template-columns:1fr; gap:38px; }
  .ecl-h1 { font-size:36px; }
  .ecl-stats-grid { grid-template-columns:repeat(2,1fr); }
  .ecl-stats-grid > div:nth-child(2) .ecl-stat { border-right:none; }
  .ecl-cats, .ecl-steps { grid-template-columns:1fr; }
  .ecl-h2, .ecl-cta-h { font-size:25px; }
  .ecl-foot-grid { grid-template-columns:1fr 1fr; }
}
`
