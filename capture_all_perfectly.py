import asyncio
from playwright.async_api import async_playwright
import urllib.request, json
import os

async def capture_all_perfectly():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(base_dir, "docs", "screenshots")
    os.makedirs(out_dir, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        # Use full HD viewport for crystal clear report figures
        context = await browser.new_context(viewport={'width': 1366, 'height': 820})
        page = await context.new_page()

        email = f"final_report_{os.getpid()}@vaultguard.local"
        password = "Correct-Horse-Battery-Staple-2026!"

        # 1. Login Page
        print("1. Capturing Login page...")
        await page.goto("http://localhost:5173/login", wait_until="load")
        await page.wait_for_timeout(800)
        await page.screenshot(path=os.path.join(out_dir, "fig_1_login.png"))

        # 2. Register Page
        print("2. Capturing Register page...")
        await page.goto("http://localhost:5173/register", wait_until="load")
        await page.fill('input[type="email"]', email)
        pws = await page.query_selector_all('input[type="password"]')
        await pws[0].fill(password)
        await pws[1].fill(password)
        await page.wait_for_timeout(800)
        await page.screenshot(path=os.path.join(out_dir, "fig_2_register.png"))

        # Submit Register
        print("Submitting register...")
        await page.click('button[type="submit"]')
        await page.wait_for_selector('div.font-mono.select-all', timeout=15000)
        rec_el = await page.query_selector('div.font-mono.select-all')
        rec_key = (await rec_el.inner_text()).strip()

        # 3. Recovery Key Page
        print("3. Capturing Recovery Key page...")
        await page.screenshot(path=os.path.join(out_dir, "fig_3_recovery_key.png"))

        last_group = rec_key.split()[-1]
        await page.fill('input#confirmKey', last_group)
        await page.wait_for_timeout(400)
        await page.click('button:has-text("Continue to Email Verification")')
        await page.wait_for_timeout(1500)

        # 4. Verify Email Page
        print("4. Capturing Verify Email page...")
        await page.screenshot(path=os.path.join(out_dir, "fig_4_verify_email.png"))

        hook_url = f"http://127.0.0.1:5000/api/v1/auth/test-hook/code?email={email}&purpose=email_verify"
        with urllib.request.urlopen(hook_url) as resp:
            data = json.loads(resp.read().decode())
            code = data.get("code")

        await page.fill('input', code)
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(2000)

        # 5. Login
        print("Logging in...")
        await page.goto("http://localhost:5173/login", wait_until="load")
        await page.fill('input[type="email"]', email)
        pws = await page.query_selector_all('input[type="password"]')
        await pws[0].fill(password)
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(3500)

        # Check if on /unlock
        if "unlock" in page.url:
            print("5. Capturing Unlock screen...")
            await page.screenshot(path=os.path.join(out_dir, "fig_5_unlock.png"))
            # Unlock it!
            await page.fill('input[type="password"]', password)
            await page.click('button:has-text("Unlock Vault")')
            await page.wait_for_timeout(3500)

        print("Logged in, URL is:", page.url)

        # 6. Dashboard
        print("6. Capturing Dashboard...")
        await page.goto("http://localhost:5173/app", wait_until="load")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(out_dir, "fig_6_dashboard.png"))

        # 7. Vault
        print("7. Capturing Vault...")
        await page.goto("http://localhost:5173/app/vault", wait_until="load")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(out_dir, "fig_7_vault.png"))

        # 8. Security Center
        print("8. Capturing Security Center...")
        await page.goto("http://localhost:5173/app/security", wait_until="load")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(out_dir, "fig_8_security_center.png"))

        # 9. Password Generator
        print("9. Capturing Generator...")
        await page.goto("http://localhost:5173/app/generator", wait_until="load")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(out_dir, "fig_9_generator.png"))

        # 10. Secure Send
        print("10. Capturing Send...")
        await page.goto("http://localhost:5173/app/send", wait_until="load")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(out_dir, "fig_10_send.png"))

        # 11. Settings & 2FA
        print("11. Capturing Settings...")
        await page.goto("http://localhost:5173/app/settings", wait_until="load")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(out_dir, "fig_11_settings.png"))

        # 12. Audit Log
        print("12. Capturing Audit Log...")
        await page.goto("http://localhost:5173/app/audit", wait_until="load")
        await page.wait_for_timeout(1800)
        await page.screenshot(path=os.path.join(out_dir, "fig_12_audit.png"))

        await browser.close()
        print("ALL 12 SCREENS CAPTURED PERFECTLY!")

if __name__ == '__main__':
    asyncio.run(capture_all_perfectly())
