# WhatsApp Assistant

A Chrome extension that enhances WhatsApp Web with powerful tools to download media and export chat conversations.

## Features

- ** Photo & Video Download** — Select individual photos/videos from a chat and download them as a ZIP archive
- ** Chat Export** — Export chat messages by date range as a formatted text file in a ZIP archive
- ** Album Extraction** — Automatically expands and downloads WhatsApp album (multi-photo) messages
- ** Date Range Filtering** — Filter messages by date before exporting
- ** Chat Preview** — Preview messages in WhatsApp-style bubbles before exporting
- ** Auto-Scan** — Automatically scans the active chat and loads older messages by scrolling up
- ** WhatsApp Dark Theme** — UI styled to match WhatsApp Web's native design language

## Installation

### From Source (Developer Mode)

1. **Clone or download** this repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/whatsapp-assistant.git
   ```

2. **Open Chrome** and go to `chrome://extensions/`

3. **Enable Developer Mode** (toggle in the top-right corner)

4. Click **Load unpacked** and select the extension folder

5. **Open** [web.whatsapp.com](https://web.whatsapp.com) — you'll see a green toggle button on the right edge

## Usage

### Downloading Photos & Videos

1. Open any WhatsApp chat
2. Click the green **🗂️** button on the right side of the screen to open the sidebar
3. The sidebar will auto-scan the chat, or click **Scan Chat**
4. Click individual media items to select them (or use **☑ All**)
5. Click **⬇ ZIP** to download the selected media

### Exporting Chat Messages

1. Open a chat and scan it using the Photos tab
2. Switch to the **Export Chat** tab
3. Set the **From** and **To** date range
4. Toggle options: Include Media, Timestamps, Sender Name
5. Click **👁 Preview** to see messages, then ** Export ZIP**

### Keyboard & Controls

- **Extension icon** in the toolbar toggles the sidebar
- The sidebar auto-detects when you switch chats and rescan
- Album messages are automatically expanded during scanning

## Technical Details

- **Manifest:** Chrome Extension Manifest V3
- **ZIP Library:** [JSZip](https://stuk.github.io/jszip/) (client-side, no server uploads)
- **Permissions:** Downloads, Scripting, Storage, ActiveTab
- **Host Access:** `web.whatsapp.com` and `*.whatsapp.net`
- **DOM Selectors:** Target WhatsApp Web's current DOM structure (may need updates if WhatsApp changes their UI)

> **Note:** WhatsApp Web frequently updates its DOM structure. If the extension stops working, check for updated CSS selectors in `content.js`.

## License

MIT
