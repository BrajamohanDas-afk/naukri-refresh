import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { chromium, type Page } from 'playwright';

const BASE: string = import.meta.dirname;
dotenv.config({ path: path.join(BASE, '.env') });
const PROFILE_DIR: string = path.join(BASE, 'profile');
const LOGS_DIR: string = path.join(BASE, 'logs');
const HOME_URL: string = 'https://www.naukri.com/mnjuser/homepage';
const PROFILE_URL: string = 'https://www.naukri.com/mnjuser/profile';
const MONTHS: ReadonlyArray<string> = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type Metrics = {
  searchAppearances: string;
  recruiterActions: string;
  raw: string;
};

type RunResult = {
  at: string;
  action: string;
  before: string;
  after: string;
  metrics: Metrics;
  screenshot: string;
};

function required(name: string): string {
  const value: string | undefined = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function istParts(date: Date): Record<string, string> {
  const formatter: Intl.DateTimeFormat = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part: Intl.DateTimeFormatPart) => part.type !== 'literal')
      .map((part: Intl.DateTimeFormatPart) => [part.type, part.value]),
  );
}

function fileStamp(date: Date): string {
  const p: Record<string, string> = istParts(date);
  return `${p.year}-${p.month}-${p.day}_${p.hour}${p.minute}`;
}

function displayStamp(date: Date): string {
  const p: Record<string, string> = istParts(date);
  return `${p.day} ${MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} IST`;
}

function metric(text: string, label: string): string {
  const pattern: RegExp = new RegExp(label + '[^0-9]{0,60}(\\d+)', 'i');
  const found: RegExpExecArray | null = pattern.exec(text);
  if (found) return found[1];
  if (/No activities yet/i.test(text)) return 'not available (No activities yet)';
  return 'not found on page';
}

async function sendMail(subject: string, body: string): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: required('SMTP_HOST'),
    port: Number(required('SMTP_PORT')),
    secure: false,
    auth: { user: required('SMTP_USER'), pass: required('SMTP_PASS').replace(/\s/g, '') },
  });
  await transporter.sendMail({
    from: required('SMTP_USER'),
    to: required('MAIL_TO'),
    subject,
    text: body,
  });
}

async function readLastUpdated(page: Page): Promise<string> {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/nlogin/')) throw new Error('SESSION_EXPIRED: run npm run login');
  await page.waitForFunction((): boolean => document.body.innerText.length > 50, null, { timeout: 20000 });
  const element = page.locator('p').filter({ hasText: 'Last updated' }).first();
  try {
    await element.waitFor({ timeout: 20000 });
  } catch {
    const text: string = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    throw new Error(`Last updated label missing at ${page.url()}: ${text.slice(0, 300)}`);
  }
  return (await element.innerText()).trim();
}

async function toggleSummary(page: Page): Promise<string> {
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/nlogin/')) throw new Error('SESSION_EXPIRED: run npm run login');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    (): boolean => [...document.querySelectorAll('h1')].some((element: Element) => element.textContent?.trim() === 'Profile Summary'),
    null,
    { timeout: 20000 },
  );
  const clicked: boolean = await page.evaluate((): boolean => {
    const labels: HTMLElement[] = [...document.querySelectorAll('h1, h2, p, span, div')]
      .filter((element: Element) => element.textContent?.trim() === 'Profile Summary') as HTMLElement[];
    for (const label of labels) {
      const parents: Array<HTMLElement | null> = [label.parentElement, label.parentElement?.parentElement ?? null];
      for (const parent of parents) {
        const pencil: Element | null = parent?.querySelector('img[alt="pencil"]') ?? null;
        if (pencil) {
          (pencil as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  });
  if (!clicked) throw new Error('Profile summary pencil not found');
  const editor = page.locator('[role=dialog] textarea').first();
  await editor.waitFor({ timeout: 15000 });
  const current: string = await editor.inputValue();
  const next: string = current.endsWith('.') ? current.slice(0, -1) : `${current}.`;
  await editor.fill(next);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('[role=dialog]').waitFor({ state: 'detached', timeout: 15000 });
  return next.endsWith('.') ? 'appended "."' : 'removed "."';
}

async function readMetrics(page: Page): Promise<Metrics> {
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/nlogin/')) throw new Error('SESSION_EXPIRED: run npm run login');
  await page.waitForFunction(
    (): boolean => document.body.innerText.includes('Activity insights'),
    null,
    { timeout: 20000 },
  );
  await page.evaluate((): void => {
    const link: HTMLElement | undefined = [...document.querySelectorAll('*')]
      .find((element: Element) => element.children.length === 0 && element.textContent?.trim() === 'Activity insights') as HTMLElement | undefined;
    if (link) link.click();
  });
  try {
    await page.waitForFunction(
      (): boolean => /No activities yet|Search appearances|Recruiter actions/i.test(document.body.innerText),
      null,
      { timeout: 12000 },
    );
  } catch {
    // Activity data may be absent; fall back to whatever text is on the tab.
  }
  const text: string = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  return {
    searchAppearances: metric(text, 'Search appearances'),
    recruiterActions: metric(text, 'Recruiter actions'),
    raw: text.slice(0, 220),
  };
}

function emailBody(result: RunResult): string {
  return [
    `Naukri refresh — ${result.at}`,
    `Status: OK (${result.action}, saved successfully)`,
    `Last updated label before: ${result.before}`,
    `Last updated label after:  ${result.after}`,
    `Search appearances: ${result.metrics.searchAppearances}`,
    `Recruiter actions:  ${result.metrics.recruiterActions}`,
    `Activity raw text: ${result.metrics.raw}`,
    `Screenshot: ${result.screenshot}`,
  ].join('\n');
}

const startedAt: Date = new Date();
await fs.mkdir(LOGS_DIR, { recursive: true });
const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1280, height: 900 },
});

try {
  const page: Page = context.pages()[0] ?? (await context.newPage());
  const before: string = await readLastUpdated(page);
  const action: string = await toggleSummary(page);
  const after: string = await readLastUpdated(page);
  const metrics: Metrics = await readMetrics(page);
  const screenshot: string = path.join(LOGS_DIR, `${fileStamp(startedAt)}.png`);
  await page.screenshot({ path: screenshot });
  const result: RunResult = {
    at: displayStamp(startedAt),
    action,
    before,
    after,
    metrics,
    screenshot,
  };
  await fs.appendFile(path.join(LOGS_DIR, 'refresh.log'), `${JSON.stringify(result)}\n`);
  await sendMail(`Naukri refresh ${result.at}`, emailBody(result));
  console.log(emailBody(result));
} catch (error: unknown) {
  const message: string = error instanceof Error ? error.message : String(error);
  await fs.appendFile(
    path.join(LOGS_DIR, 'refresh.log'),
    `${JSON.stringify({ at: displayStamp(startedAt), error: message })}\n`,
  );
  try {
    await sendMail(`Naukri refresh FAILED ${displayStamp(startedAt)}`, message);
  } catch (mailError: unknown) {
    console.error(`Failure email could not be sent: ${String(mailError)}`);
  }
  console.error(message);
  process.exitCode = 1;
} finally {
  await context.close();
}
