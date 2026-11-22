import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import Landing from "@/app/page";
import { ACCOUNT_NOTE, LoginForm, submitLogin } from "@/app/login/LoginForm";

afterEach(() => vi.unstubAllGlobals());

test("landing renders hero and links", () => {
  const html = renderToStaticMarkup(React.createElement(Landing));
  expect(html).toContain("졸업 다음 달,");
  expect(html).toContain('href="/login"');
  expect(html).toContain('href="/app#signup"');
  expect(html).not.toContain(".html");
});

test("login sends credentials only to the account API and never stores them", async () => {
  const store = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn(), clear: vi.fn() };
  vi.stubGlobal("localStorage", store);
  vi.stubGlobal("sessionStorage", store);
  const login = vi.fn(async () => ({ mode: "account" as const, userId: "u", displayName: "a", durable: true }));
  expect(await submitLogin("", "pw", login)).toBe("이메일과 비밀번호를 입력해 주세요.");
  expect(login).not.toHaveBeenCalled();
  expect(await submitLogin("a@example.com", "password123", login)).toBeNull();
  expect(login).toHaveBeenCalledWith("a@example.com", "password123");
  expect(await submitLogin("a@example.com", "wrong", async () => { throw new Error("이메일 또는 비밀번호가 맞지 않아요."); })).toBe("이메일 또는 비밀번호가 맞지 않아요.");
  expect(store.setItem).not.toHaveBeenCalled();
  const html = renderToStaticMarkup(React.createElement(LoginForm));
  expect(html).toContain("로그인");
  expect(html).toContain('href="/app#signup"');
  expect(html).toContain(ACCOUNT_NOTE);
});

test("login has no social sign-in", () => {
  const html = renderToStaticMarkup(React.createElement(LoginForm));
  for (const word of ["카카오", "네이버", "또는", "시연용 화면"]) expect(html).not.toContain(word);
});
