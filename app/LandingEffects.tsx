"use client";
import { useEffect, useState } from "react";
import styles from "./site.module.css";

// 소개 화면의 첫 로딩 막대를 그리고, 스크롤로 내려온 구역에 등장 효과를 붙인다
export default function LandingEffects() {
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const imgs = Array.from(document.images);
    let loaded = 0, shown = 0, ready = document.readyState === "complete", raf = 0, timer = 0;
    const count = () => { loaded++; };
    imgs.forEach(im => { if (im.complete) loaded++; else { im.addEventListener("load", count); im.addEventListener("error", count); } });
    const onLoad = () => { ready = true; };
    window.addEventListener("load", onLoad);
    const start = performance.now();
    const tick = () => {
      const target = Math.min(100, Math.round(loaded / Math.max(imgs.length, 1) * 100), Math.round((performance.now() - start) / 14));
      shown += Math.max(0, (target - shown) * 0.2);
      const v = Math.round(shown);
      setPct(v);
      if (ready && v >= 99) { setPct(100); timer = window.setTimeout(() => setDone(true), 250); return; }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); window.removeEventListener("load", onLoad); imgs.forEach(im => { im.removeEventListener("load", count); im.removeEventListener("error", count); }); };
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add(styles.in); io.unobserve(e.target); } }), { threshold: 0.2, rootMargin: "0px 0px -10% 0px" });
    document.querySelectorAll(`.${styles.reveal}`).forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className={`${styles.loader} ${done ? styles.done : ""}`} role="status" aria-live="polite">
      <div className={styles.crewRow} aria-hidden="true">
        <img src="/pathfinder/robot-magnifier.png" alt="" /><img src="/pathfinder/robot-map.png" alt="" /><img src="/pathfinder/robot-wave.png" alt="" /><img src="/pathfinder/robot-flag.png" alt="" />
      </div>
      <p>길잡이들이 오고 있어요</p>
      <div className={styles.bar}><i style={{ width: `${pct}%` }} /></div>
      <small>{pct}%</small>
    </div>
  );
}
