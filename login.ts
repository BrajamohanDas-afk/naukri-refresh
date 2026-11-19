import path from 'node:path';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

const BASE: string = import.meta.dirname;
dotenv.config({ path: path.join(BASE, '.env') });
const PROFILE_DIR: string = path.join(BASE, 'profile');
const LOGIN_URL: string = 'https://www.naukri.com/nlogin/login';
const HOME_URL: RegExp = /naukri\.com\/mnjuser\/homepage/;

function required(name: string): string {
  const value: string | undefined = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

const user: string = required('NAUKRI_USER');
const pass: string = required('NAUKRI_PASS');

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1280, height: 900 },
});

try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(LOGIN_URL);
  await page.getByRole('textbox', { name: 'Enter Email ID / Username' }).fill(user);
  await page.getByRole('textbox', { name: 'Enter Password' }).fill(pass);
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL(HOME_URL, { timeout: 30000 });
  console.log(`Login OK. Session saved in ${PROFILE_DIR}`);
} finally {
  await context.close();
}
