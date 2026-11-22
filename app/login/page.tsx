import Link from "next/link";
import { LoginForm } from "./LoginForm";
import styles from "../site.module.css";

export const metadata = { title: "PathFinder 로그인" };

// 로그인 페이지 : 시안 login.html (시연용)
export default function LoginPage() {
  return (
    <div className={styles.loginPage}>
      <aside className={styles.side}>
        <Link className={styles.logo} href="/"><img src="/pathfinder/robot-face.png" alt="" />PathFinder</Link>
        <div className={styles.copy}>
          <h1>다시 오셨네요.<br /><span>그려 둔 경로</span>가 기다려요.</h1>
          <p>로그인하면 저장해 둔 계획과, 그 사이 새로 열리거나 바뀐 지원을 이어서 볼 수 있어요.</p>
          <img className={styles.robot} src="/pathfinder/robot-flag.png" alt="깃발을 든 길잡이 로봇" />
        </div>
        <span></span>
      </aside>
      <main className={styles.main}><LoginForm /></main>
    </div>
  );
}
