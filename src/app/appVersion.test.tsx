import { readFileSync } from 'node:fs';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

/**
 * The version badge used to be the hardcoded string "V0.1", so bumping
 * package.json to 0.2.0 left every user still looking at V0.1. It is now
 * injected from package.json by vite.config.ts; this test is the guard that
 * keeps the only user-visible version honest.
 */
describe('使用者可見的版號', () => {
  const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;

  it('注入的 __APP_VERSION__ 就是 package.json 的版號', () => {
    expect(__APP_VERSION__).toBe(version);
  });

  it('標頭徽章顯示真正的版號，不是寫死的字串', async () => {
    // LibraryProvider 會非同步載入內建範本，用 act 把它的更新收進來，
    // 避免測試輸出留下 act() 警告。
    await act(async () => {
      render(<App />);
    });
    expect(screen.getByText(`v${version}`)).toBeInTheDocument();
  });

  it('版號不是寫死在元件裡（改 package.json 就會反映）', () => {
    expect(readFileSync('src/app/App.tsx', 'utf8')).not.toMatch(/badge">[Vv]\d/);
  });
});
