# Setup guide: credentials and accounts

This is everything you need to run Arko Pay-on-Proof against the real PayPal Sandbox and Claude, then publish it. It takes about 15 minutes.

> Never paste secrets into chat, issues or commits. They go only into your local `.env` file (which git ignores) and into the Render dashboard.

---

## 1. PayPal Developer account (free)

1. Go to <https://developer.paypal.com> and choose **Log in to Dashboard**. Use any PayPal account, or create one. The same login works for the Developer Dashboard, and you don't need to install anything.
2. When you first sign in, PayPal automatically creates **two sandbox test accounts**: one **Business** account and one **Personal** account.

## 2. Create the sandbox app (Client ID and Secret)

1. Open **Apps & Credentials**: <https://developer.paypal.com/dashboard/applications/sandbox>
2. Make sure the toggle at the top says **Sandbox** (not Live).
3. Click **Create App**:
   - **App Name:** `Arko Pay-on-Proof`
   - **Type:** **Merchant**
   - **Sandbox Business Account:** keep the default `sb-…@business.example.com`
4. On the app page, copy the **Client ID** and click to reveal and copy the **Secret**.
5. Scroll to **Features** (sometimes labelled *Sandbox App Settings*) and make sure these are ticked. Click **Save Changes** if you change anything.
   - ✅ **Accept payments** (needed for orders, authorizations and captures)
   - ✅ **Invoicing** (needed for the receipt invoice after a release)
   - ✅ **Payouts** (needed to pay sub-contractors; optional)

   If a feature isn't listed for your region, the app still works. Receipts and payouts are best-effort and get skipped with a note in the audit trail.

## 3. Find the sandbox buyer login (to approve holds)

1. In the left sidebar, go to **Testing Tools → Sandbox Accounts**: <https://developer.paypal.com/dashboard/accounts>
2. Find the **Personal** account (`sb-…@personal.example.com`). Click **⋯ → View/Edit Account** to see its **email** and **system-generated password**.
3. This is the **client (payer)** login. When Arko opens the PayPal window to place a hold, sign in with it. It's a **sandbox** login: it only works on `sandbox.paypal.com`, not on paypal.com.
4. The account comes with fake money already loaded. If a payment fails because of the balance, you can top it up under *View/Edit Account*.
5. *(Optional)* The **Business** account (`sb-…@business.example.com`) is the **freelancer (payee)**. Sign in to <https://www.sandbox.paypal.com> with it to watch held, captured and refunded money arrive, and to see receipt invoices.

> Tip: make sure **Negative Testing** is **Off** on the Business account (*View/Edit Account → Settings*). When it's on, every transaction fails.

## 4. Anthropic API key (Claude)

1. Go to <https://console.anthropic.com> → **API Keys** → **Create Key**.
2. Make sure the workspace has billing or credits enabled.

## 5. Put the keys in `.env`

```bash
cd arko-pay
cp .env.example .env
```

Open `.env` in an editor and fill in:

```ini
PAYPAL_CLIENT_ID=<Client ID from step 2>
PAYPAL_CLIENT_SECRET=<Secret from step 2>
PAYPAL_ENV=sandbox
ANTHROPIC_API_KEY=<key from step 4>
PUBLIC_URL=http://localhost:5173
```

Then run:

```bash
npm install
npm run dev
```

Open <http://localhost:5173>. In the left sidebar (bottom), both **PayPal sandbox** and **Claude agents** should show a green dot.

## 6. GitHub (required for submission)

1. Create an **empty public** repository at <https://github.com/new>, for example `arko-pay`, with no README and no license (both are already in the project).
2. Send the repo URL to Claude. It commits and pushes when you say so. The MIT `LICENSE` is at the repo root, so GitHub shows it in the **About** panel automatically.

## 7. Render (hosted demo, recommended)

1. Sign up at <https://render.com> with GitHub.
2. Choose **New → Blueprint**, pick the repository, and Render reads `render.yaml`.
3. Enter the secret values when asked (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `ANTHROPIC_API_KEY`). Set `PUBLIC_URL` to the service URL Render gives you, for example `https://arko-pay.onrender.com`.
4. Open the URL. This is the **hosted demo URL** for the Devpost form.

## Checklist to send back

- [ ] `.env` filled in (you don't need to send anything: Claude can see whether the app reports PayPal and Claude as *configured*)
- [ ] Sandbox **Personal** account email and password noted (you type them into PayPal's window yourself)
- [ ] GitHub repo URL
- [ ] *(optional)* Render service URL
