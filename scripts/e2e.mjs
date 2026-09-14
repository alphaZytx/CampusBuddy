// Browser run: drives the production builds of the student app and the admin panel in
// headless Chrome, against the real API and the seeded demo data.
//
// It posts requests and changes state, so run it against freshly reset demo data:
//
//   npm run db:reset && npm run build
//   npm start                                     # API on :4000
//   npm run preview -w mobile -- --port 4173      # production student app
//   npm run preview -w admin -- --port 4174       # production admin panel
//   npm run test:e2e
//
// Uses the Chrome already installed on the machine (puppeteer-core downloads no browser).
// Override the locations with CHROME_PATH, APP_URL, ADMIN_URL and API_URL.
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const APP = process.env.APP_URL ?? 'http://localhost:4173';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:4174';
const API = process.env.API_URL ?? 'http://localhost:4000/api';
const PASSWORD = process.env.SEED_PASSWORD ?? 'CampusBuddy@2026';

const results = [];
let failures = 0;
let stage = 'start';
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(url, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await pause(500);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const byText = (tag, text) => `::-p-xpath(//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})])`;

/** Sheets slide up for a quarter of a second; wait for finite animations to finish. */
async function settle(page) {
  await page
    .waitForFunction(
      () =>
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
          .every((animation) => animation.playState !== 'running'),
      { timeout: 3_000 },
    )
    .catch(() => undefined);
}

async function clickText(page, tag, text, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const handle = await page.waitForSelector(byText(tag, text), {
        visible: true,
        timeout: Math.max(1_000, deadline - Date.now()),
      });
      await settle(page);
      await handle.click();
      return;
    } catch (error) {
      lastError = error;
      await pause(250);
    }
  }
  throw new Error(`could not click "${text}": ${lastError?.message}`);
}

async function hasText(page, text, timeout = 15_000) {
  try {
    await page.waitForSelector(byText('body', text), { timeout });
    return true;
  } catch {
    return false;
  }
}

await waitFor(`${API}/health`);
await waitFor(APP);
await waitFor(ADMIN);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
const pageErrors = [];

async function openPage(label) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844 });
  page.on('pageerror', (error) => pageErrors.push(`${label}: ${error.message}`));
  return page;
}

async function signIn(email) {
  const page = await openPage(email);
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle0' });
  await page.type('#email', email);
  await page.type('#password', PASSWORD);
  await clickText(page, 'button', 'Sign in');
  await page.waitForFunction(() => location.pathname === '/', { timeout: 15_000 });
  return page;
}

const rewardInput = '::-p-xpath(//label[normalize-space(.)="Helper reward"]/following-sibling::div//input)';

try {
  // --- A request, end to end, through the withdraw-and-reselect path -------------
  stage = 'Rahul signs in and posts';
  const rahul = await signIn('rahul.ug22.cs@nitp.ac.in');
  check('Rahul signs in to the production build', true);

  await rahul.goto(`${APP}/create`, { waitUntil: 'networkidle0' });
  await rahul.type('#title', 'E2E: bring a notebook');
  await (await rahul.waitForSelector(rewardInput)).type('15');
  await clickText(rahul, 'button', 'Post request');
  await rahul.waitForFunction(() => /^\/requests\//.test(location.pathname), { timeout: 15_000 });
  const requestUrl = rahul.url();
  check('Rahul posts a request', await hasText(rahul, 'E2E: bring a notebook'));

  stage = 'Aman offers';
  const aman = await signIn('aman.ug22.cs@nitp.ac.in');
  await aman.goto(requestUrl, { waitUntil: 'networkidle0' });
  await clickText(aman, 'button', 'Offer to help');
  await clickText(aman, 'button', 'Send offer');
  check('Aman offers to help', await hasText(aman, 'Offer sent'));

  stage = 'Rahul chooses Aman';
  check('The offer reaches Rahul live, without a refresh', await hasText(rahul, 'Choose one', 15_000));
  await clickText(rahul, 'button', 'Choose');
  check('Rahul selects Aman', await hasText(rahul, 'Helper selected'));

  stage = 'Aman accepts, starts and withdraws';
  await aman.reload({ waitUntil: 'networkidle0' });
  await clickText(aman, 'button', 'Accept task');
  await hasText(aman, 'Task accepted');
  await clickText(aman, 'button', 'Start task');
  await hasText(aman, 'Task started');
  await clickText(aman, 'button', 'Withdraw');
  check('Aman withdraws mid-task', await hasText(aman, 'You withdrew from this task'));

  stage = 'Rahul reopens and chooses again';
  await rahul.reload({ waitUntil: 'networkidle0' });
  await clickText(rahul, 'button', 'Reopen request');
  check('Rahul reopens the request', await hasText(rahul, 'Request reopened'));

  await aman.reload({ waitUntil: 'networkidle0' });
  await clickText(aman, 'button', 'Offer to help');
  await clickText(aman, 'button', 'Send offer');
  await hasText(aman, 'Offer sent');
  await rahul.reload({ waitUntil: 'networkidle0' });
  await clickText(rahul, 'button', 'Choose');
  check('Rahul can choose a helper again after a withdrawal', await hasText(rahul, 'Helper selected'));

  // --- Signing out ends only this device's session -------------------------------
  stage = 'sign out on one device';
  const amanPhone = await signIn('aman.ug22.cs@nitp.ac.in');
  await aman.goto(`${APP}/profile`, { waitUntil: 'networkidle0' });
  await clickText(aman, 'button', 'Sign out');
  await aman.waitForFunction(() => location.pathname === '/welcome', { timeout: 15_000 });
  const otherDevice = await amanPhone.evaluate(async () => {
    const session = JSON.parse(localStorage.getItem('campusbuddy.session'));
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (response.ok) {
      const data = await response.json();
      localStorage.setItem(
        'campusbuddy.session',
        JSON.stringify({ accessToken: data.accessToken, refreshToken: data.refreshToken }),
      );
    }
    return response.status;
  });
  check('Signing out on one device leaves the other signed in', otherDevice === 200, `refresh → ${otherDevice}`);

  // --- Contacting a seller is a private request to them alone ---------------------
  stage = 'contact the seller';
  await rahul.goto(`${APP}/marketplace`, { waitUntil: 'networkidle0' });
  const listings = await rahul.$$eval('a[href^="/marketplace/"]', (links) =>
    links.map((link) => link.getAttribute('href')).filter((href) => href !== '/marketplace/new'),
  );
  let contacted = false;
  for (const href of listings) {
    await rahul.goto(`${APP}${href}`, { waitUntil: 'networkidle0' });
    if (!(await hasText(rahul, 'Contact the seller', 3_000))) continue;
    await clickText(rahul, 'button', 'Contact the seller');
    const isPrivate = await hasText(rahul, 'will see this');
    const title = await rahul.$eval('#title', (input) => input.value);
    check('"Contact the seller" opens a pre-filled request only the seller can see', isPrivate && title.startsWith('Buy: '), title);
    const reward = await rahul.waitForSelector(rewardInput);
    if (!(await reward.evaluate((input) => input.value))) await reward.type('10');
    await clickText(rahul, 'button', 'Send to');
    await rahul.waitForFunction(() => /^\/requests\//.test(location.pathname), { timeout: 15_000 });
    check('The private request is sent to the seller', await hasText(rahul, 'Request sent to'));
    contacted = true;
    break;
  }
  if (!contacted) check('"Contact the seller"', false, 'no listing by another student');

  // --- The installed app opens offline, keeps the session, and recovers ----------
  stage = 'offline';
  await rahul.goto(`${APP}/`, { waitUntil: 'networkidle0' });
  await rahul.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await rahul.setOfflineMode(true);
  await rahul.reload({ waitUntil: 'domcontentloaded' });
  check('Offline, the app still opens and says so, without signing out', await hasText(rahul, 'reach CampusBuddy', 15_000));
  await rahul.setOfflineMode(false);
  check('Back online, it recovers by itself', await hasText(rahul, 'You could help with', 30_000));

  // --- Admin: an empty geofence field is refused ----------------------------------
  stage = 'admin geofence';
  const admin = await openPage('admin');
  await admin.setViewport({ width: 1280, height: 900 });
  await admin.goto(ADMIN, { waitUntil: 'networkidle0' });
  await admin.type('#email', 'admin@nitp.ac.in');
  await admin.type('#password', PASSWORD);
  await clickText(admin, 'button', 'Sign in');
  check('The admin signs in to the admin panel', await hasText(admin, 'Registered students'));
  await admin.goto(`${ADMIN}/campus`, { waitUntil: 'networkidle0' });
  await admin.waitForFunction(() => document.querySelector('#lat')?.value !== '', { timeout: 10_000 });
  await admin.click('#lat');
  await admin.evaluate(() => document.querySelector('#lat').select());
  await admin.keyboard.press('Backspace');
  const cleared = await admin.$eval('#lat', (input) => input.value);
  await clickText(admin, 'button', 'Save');
  const refused = await hasText(admin, 'Enter a centre latitude', 5_000);
  const shown = refused ? '' : await admin.$$eval('.alert', (alerts) => alerts.map((a) => a.textContent).join(' / '));
  check('An empty geofence latitude is refused', refused && cleared === '', shown || `field was "${cleared}"`);
} catch (error) {
  check(`Script completed (stopped at: ${stage})`, false, error.message);
} finally {
  check('No uncaught errors in either app', pageErrors.length === 0, pageErrors.join(' | '));
  await browser.close();
  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}
