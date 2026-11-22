import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import Landing from "@/app/page";
import { demoSubmit, DEMO_MESSAGE, LoginForm } from "@/app/login/LoginForm";

afterEach(() => vi.unstubAllGlobals());

test("landing renders hero and links", () => {
  const html = renderToStaticMarkup(React.createElement(Landing));
  expect(html).toContain("졸업 다음 달,");
  expect(html).toContain('href="/login"');
  expect(html).toContain('href="/app#signup"');
  expect(html).not.toContain(".html");
});

test("demo login never sends or stores input", () => {
  const fetchSpy = vi.fn();
  const store = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("sessionStorage", store);
  const go = vi.fn();
  const preventDefault = vi.fn();
  demoSubmit({ preventDefault }, go);
  expect(preventDefault).toHaveBeenCalled();
  expect(go).toHaveBeenCalledWith("/app#building");
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(store.setItem).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(React.createElement(LoginForm));
  expect(html).toContain("로그인");
  expect(html).toContain('href="/app#signup"');
  expect(DEMO_MESSAGE).toBe("시연용 화면이에요. 입력한 내용은 어디로도 전송되지 않아요.");
});
