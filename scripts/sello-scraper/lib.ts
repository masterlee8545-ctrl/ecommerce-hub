/**
 * 셀록홈즈 스크래퍼 공통 유틸 (env 로드, launch 옵션)
 *
 * BUYWISE(buywise-marketing-tool) 에서 그대로 포팅. 이커머스허브는
 * 별도 setup 스크립트를 두지 않고 BUYWISE 가 이미 준비한 C:\sello-user-data
 * 프로필을 공유해서 사용한다.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LaunchOptions } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT = path.resolve(__dirname, '..', '..');
export const ENV_PATH = path.join(ROOT, '.env.local');

/** .env.local에서 특정 키 값을 읽는다. 따옴표('' / "" / unquoted) 지원 */
export async function readEnvVar(key: string): Promise<string | null> {
  const content = await fs.readFile(ENV_PATH, 'utf-8');
  const pattern = new RegExp(
    `^${key}=(?:'([^']*)'|"([^"]*)"|([^\\r\\n]*))`,
    'm',
  );
  const m = content.match(pattern);
  if (!m) return null;
  return (m[1] ?? m[2] ?? m[3] ?? '').trim() || null;
}

export interface ExtensionConfig {
  extensionPath: string;
  profileDir: string;
}

export async function loadExtensionConfig(): Promise<ExtensionConfig> {
  const extensionPath = await readEnvVar('SELLO_EXTENSION_PATH');
  if (!extensionPath) {
    throw new Error(
      'SELLO_EXTENSION_PATH가 .env.local에 없습니다. ' +
        '값 예시: C:\\Users\\pc\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\<ID>\\<VERSION>_0',
    );
  }
  // 경로 실존 확인 (manifest.json)
  const manifestPath = path.join(extensionPath, 'manifest.json');
  try {
    await fs.access(manifestPath);
  } catch {
    throw new Error(`manifest.json이 없습니다: ${manifestPath}`);
  }
  const profileDir = process.env['SELLO_CHROME_PROFILE'] ?? 'C:\\sello-profile';
  return { extensionPath, profileDir };
}

/** launchPersistentContext에 넘길 기본 args (확장 로드 포함) */
export function buildLaunchArgs(
  extensionPath: string,
  options?: { maximized?: boolean },
): string[] {
  const args = [
    '--disable-blink-features=AutomationControlled',
    '--no-default-browser-check',
    '--no-first-run',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ];
  if (options?.maximized) {
    args.push(
      '--start-maximized',
      '--new-window',
      '--window-position=0,0',
      '--window-size=1400,900',
    );
  }
  return args;
}

/** launchPersistentContext 옵션 (scrape 공용 기본값) */
export function buildLaunchOptions(
  extensionPath: string,
  options?: { maximized?: boolean },
): LaunchOptions {
  return {
    channel: 'chrome',
    headless: false,
    args: buildLaunchArgs(extensionPath, options),
  };
}
