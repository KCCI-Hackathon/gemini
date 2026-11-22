import Link from "next/link";
import LandingEffects from "./LandingEffects";
import styles from "./site.module.css";

const P = "/pathfinder/";

// 소개 페이지 : 시안 index.html 의 마크업과 문구
export default function Landing() {
  const rv = (extra = "") => `${styles.reveal} ${extra}`.trim();
  return (
    <div className={styles.page}>
      <LandingEffects />
      <header className={styles.header}>
        <a className={styles.logo} href="#"><img src={`${P}robot-face.png`} alt="" />PathFinder</a>
        <nav className={styles.nav}><a href="#story">이런 적 있나요</a><a href="#how">쓰는 법</a><a href="#crew">길잡이들</a><Link href="/login">로그인</Link><Link className={styles.pill} href="/login">내 경로 그려 보기</Link></nav>
      </header>

      <section className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>청년을 위한 정책 길잡이 · PathFinder</p>
          <h1 className={styles.title}>졸업 다음 달,<br /><span className={styles.grad}>나는 무엇을 받을 수 있을까?</span></h1>
          <p className={styles.lead}>앞으로의 계획을 들려주세요. 그 계획이 지나가는 길목마다 어떤 지원이 열리고 언제 닫히는지, 미리 펼쳐 보여 드릴게요.</p>
          <a className={styles.follow} href="#story">길잡이를 따라가 보세요 ↓</a>
        </div>
        <div className={styles.stage} aria-hidden="true">
          <div className={styles.arch}></div>
          <div className={`${styles.float} ${styles.p1}`}><img src={`${P}prop-calendar.png`} alt="" /></div>
          <div className={`${styles.float} ${styles.p2}`}><img src={`${P}prop-magnifier.png`} alt="" /></div>
          <div className={`${styles.float} ${styles.p3}`}><img src={`${P}prop-document.png`} alt="" /></div>
          <div className={`${styles.float} ${styles.ground} ${styles.b1}`}><img src={`${P}robot-magnifier.png`} alt="" /></div>
          <div className={`${styles.float} ${styles.ground} ${styles.b2}`}><img src={`${P}robot-map.png`} alt="" /></div>
        </div>
        <span className={styles.scroll}>아래로 스크롤 ↓</span>
      </section>

      <section className={`${styles.story} ${rv()}`} id="story">
        <div>
          <p className={styles.kicker}>이런 적 있나요?</p>
          <h2 className={styles.h2}>알고 보니<br /><em>지난달에 마감</em>된 지원.</h2>
          <p className={styles.desc}>자격은 됐는데 신청 기간이 지났거나, 교육을 듣는 동안은 안 된다는 조건을 뒤늦게 알게 되는 일. 지원은 많지만, 그걸 내 일정에 맞춰 보는 건 늘 혼자의 몫이었어요.</p>
        </div>
        <div className={`${styles.visual} ${styles.stack}`}>
          <div className={`${styles.bubble} ${styles.me}`}><small>나</small>이 지원, 저도 받을 수 있었던 거죠?</div>
          <div className={styles.bubble}><small>담당 창구</small>네, 조건은 맞으셨는데… 접수는 지난주에 끝났어요.</div>
          <div className={`${styles.bubble} ${styles.me}`}><small>나</small>미리 알았으면 좋았을 텐데요.</div>
          <img className={styles.deco} src={`${P}prop-calendar.png`} alt="" style={{ right: -24, bottom: -40 }} />
        </div>
      </section>

      <section className={`${styles.story} ${rv(styles.flip)}`} id="how">
        <div>
          <p className={styles.kicker}>대화하듯 계획을 말하면</p>
          <h2 className={styles.h2}>길목마다<br /><em>깃발을 꽂아</em> 드려요.</h2>
          <p className={styles.desc}>수료하는 날, 일을 시작할 즈음, 이사 계획처럼 앞으로 바뀔 일을 골라 답하면 충분해요. 바뀌는 날마다 받을 수 있는 지원을 다시 따져서, 마감이 빠른 것부터 달력 위에 놓아 드려요.</p>
        </div>
        <div className={`${styles.visual} ${styles.stack}`}>
          <div className={styles.bubble}><small>PathFinder</small>지금 듣는 교육은 언제 끝나나요?</div>
          <div className={`${styles.bubble} ${styles.me}`}><small>나</small>12월 19일이요. 그 다음엔 바로 일자리를 찾을 거예요.</div>
          <div className={styles.pipe}>
            <div className={styles.colm}><h4>12월에 마감</h4><div className={styles.card}>자격증 응시료 지원</div><div className={styles.card}>국민취업지원제도</div></div>
            <div className={styles.marker}>교육 끝 12/19</div>
            <div className={styles.colm}><h4>1월에 마감</h4><div className={`${styles.card} ${styles.g}`}>K-뉴딜 아카데미</div></div>
            <div className={styles.colm}><h4>언제든</h4><div className={`${styles.card} ${styles.g}`}>청년도전지원사업</div></div>
          </div>
          <img className={styles.deco} src={`${P}robot-flag.png`} alt="" style={{ left: -30, bottom: -56, width: 130 }} />
        </div>
      </section>

      <section className={`${styles.story} ${rv()}`} id="trust">
        <div>
          <p className={styles.kicker}>왜 그렇게 판단했는지까지</p>
          <h2 className={styles.h2}>추천에는 늘<br /><em>공고 원문</em>이 따라와요.</h2>
          <p className={styles.desc}>PathFinder의 AI는 기관 공고를 직접 찾아 읽고, 판단에 쓴 문장을 그대로 보여 줘요. 근거를 못 찾은 추천은 내보내지 않고, 받을 수 있는지는 정해진 규칙으로만 계산해요.</p>
        </div>
        <div className={`${styles.visual} ${styles.stack}`}>
          <div className={styles.quote}>“신청일로부터 6개월 이내 취업 및 직업훈련 참여 이력이 없어야 신청 가능합니다.”<br /><small>고용24 · 청년도전지원사업 안내 · 기준일: 신청일</small></div>
          <div className={styles.bubble}><small>PathFinder</small>그래서 이 지원은 교육이 끝나고 6개월 뒤부터 보시면 돼요. 그 전에는 응시료 지원을 먼저 챙기세요.</div>
          <img className={styles.deco} src={`${P}prop-document.png`} alt="" style={{ right: -20, top: -64, width: 110 }} />
          <img className={styles.deco} src={`${P}robot-magnifier.png`} alt="" style={{ right: 10, bottom: -60, width: 140 }} />
        </div>
      </section>

      <section className={`${styles.crew} ${rv()}`} id="crew">
        <p className={styles.kicker}>함께 길을 찾는</p>
        <h2 className={styles.h2}>PathFinder <em>길잡이들</em></h2>
        <div className={styles.grid}>
          <div><img src={`${P}robot-magnifier.png`} alt="돋보기를 든 로봇" /><b>찾아보는 길잡이</b><span>흩어진 공고를 찾아 조건을 꼼꼼히 확인해요</span></div>
          <div><img src={`${P}robot-map.png`} alt="지도를 든 로봇" /><b>그려 주는 길잡이</b><span>내 계획을 날짜 위의 경로로 바꿔 그려요</span></div>
          <div><img src={`${P}robot-wave.png`} alt="손 흔드는 로봇" /><b>물어보는 길잡이</b><span>어렵지 않은 질문 몇 개로 상황을 알아들어요</span></div>
          <div><img src={`${P}robot-flag.png`} alt="깃발을 든 로봇" /><b>알려 주는 길잡이</b><span>신청할 때가 오면 놓치지 않게 짚어 줘요</span></div>
        </div>
      </section>

      <section className={`${styles.process} ${rv()}`}>
        <p className={styles.kicker}>처음 써 본다면</p>
        <h2 className={styles.h2}>3분이면 <em>내 경로</em>가 보여요.</h2>
        <div className={styles.steps}>
          <div className={styles.step}><i>01</i><h3>지금 나를 알려 주세요</h3><p>생년월일, 사는 곳, 학력. 이 세 가지면 시작할 수 있어요.</p></div>
          <div className={styles.step}><i>02</i><h3>앞으로를 골라 주세요</h3><p>교육이 끝나는 때, 일을 시작할 즈음, 창업이나 이사 계획을 선택지로 답해요.</p></div>
          <div className={styles.step}><i>03</i><h3>달력에서 확인하세요</h3><p>지금 챙길 것과 나중에 챙길 것이 마감 순서대로 놓여요. 카드를 누르면 근거 문장이 보여요.</p></div>
        </div>
      </section>

      <section className={`${styles.cta} ${rv()}`} id="cta">
        <div>
          <p className={styles.kicker}>다음 달의 나를 위해</p>
          <h2 className={styles.h2}>오늘, <em>3분만</em> 써 볼까요?</h2>
          <p className={styles.desc}>놓치고 나서 아쉬워하기 전에, 받을 수 있는 지원을 먼저 만나 보세요.</p>
          <Link className={styles.pill} href="/app#signup">내 경로 시뮬레이션하기</Link>
        </div>
        <div className={`${styles.float} ${styles.ground}`}><img src={`${P}robot-wave.png`} alt="손 흔드는 PathFinder 로봇" /></div>
      </section>

      <footer className={styles.footer}><span>PathFinder · 팀 이쁜사과</span><span>2026 대한민국 청년 CAREER FAIR AI 해커톤 출품작</span></footer>
    </div>
  );
}
