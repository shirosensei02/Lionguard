# LionGuard 🦁

*Your privacy-first, first line of defense online.*

A browser extension developed by **Team Polymeowphism** 

---

## 🚀 Overview

**LionGuard** is a lightweight, privacy-respecting browser extension that provides real-time protection against modern web threats. It is specifically designed to address common online scam patterns prevalent in Singapore, acting as an intelligent co-pilot for your browsing sessions.

The core problem we address is the vulnerability of everyday users to sophisticated phishing attacks and the inadvertent leakage of **Personally Identifiable Information (PII)**. Existing security tools often lack the context to detect localized scam tactics or the nuance to prevent accidental data submission on untrusted sites.

LionGuard stands out by being:
* **Singapore-Focused:** Uniquely tailored to recognize local identifiers like **NRIC/FIN** and common scam phrases.
* **PII-Aware:** Unlike typical blockers, LionGuard actively monitors form inputs to prevent you from submitting sensitive data to malicious sites.
* **Privacy-First:** All processing is done locally within your browser by default. No personal data is sent to external servers without your explicit consent.

### Key Features
* 🛡️ **Real-time Malicious URL Scanner:** Checks websites against known blocklists and alerts you before you land on a dangerous page.
* 🔎 **PII Detection Engine:** Intelligently identifies input fields for sensitive information (NRIC, phone numbers, credit cards) and displays a non-intrusive warning on untrusted pages.
* 📧 **Email Breach Checker:** A quick, at-a-glance tool to see if your email address has been compromised in known data breaches.
* 📊 **Simple Dashboard:** A clean popup UI that provides immediate stats on sites flagged and PII warnings triggered, giving you a clear picture of how LionGuard is protecting you.

## ⚙️ Getting Started

### How to Run Dev Env

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/your-username/lionguard.git](https://github.com/your-username/lionguard.git)
    ```

2.  **Navigate to the project directory:**
    ```bash
    cd lionguard
    ```

3.  **Install the dependencies:**
    ```bash
    pnpm install
    ```

4.  **Set up environment variables:**
    The extension may require API keys for certain features.
    * Create a file named `.env` in the root of the project.
    * Add your API key to this file as shown below:
        ```
        VITE_API_KEY=32626bb8e6bb816d3ce04f19d1f47596883726b3b017ebec13bc74d9ff7461d7
        ```

5.  **Start the development server:**
    This command will build the extension and watch for any file changes, rebuilding automatically.
    ```bash
    pnpm dev
    ```



That's it! This command will automatically build the extension, open a new Chrome window with LionGuard already loaded!
