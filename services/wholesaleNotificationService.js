const fs = require('fs');
const os = require('os');
const path = require('path');
const qrcode = require('qrcode-terminal');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');

let PDFDocument = null;

try {
  PDFDocument = require('pdfkit');
} catch (error) {
  PDFDocument = null;
}

const formatCurrency = (value) => `INR ${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const pickEnv = (...keys) => {
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return '';
};

const isPlaceholderValue = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const placeholderTokens = [
    'your-real-gmail@gmail.com',
    'your-gmail-app-password',
    'acxxxxxxxxxxxxxxxxxxxx',
    'xxxxxxxxxxxxxxxxxxxx',
    '+1xxxxxxxxxx',
    'your-domain.com',
    'example',
    'placeholder'
  ];

  return placeholderTokens.some((token) => normalized.includes(token));
};

const getConfiguredValue = (...keys) => {
  const value = pickEnv(...keys);
  return isPlaceholderValue(value) ? '' : value;
};

const normalizePhoneForSms = (phone) => {
  const raw = String(phone || '').trim();
  if (!raw) return '';

  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (raw.startsWith('+')) {
    return digits;
  }

  const defaultCode = String(process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || process.env.SMS_DEFAULT_COUNTRY_CODE || '+91').replace(/\D/g, '');
  if (digits.length === 10 && defaultCode) {
    return `${defaultCode}${digits}`;
  }

  return digits;
};

const whatsappSessionState = {
  socket: null,
  readyPromise: null
};

const getSocketAuthId = (socket) =>
  socket?.authState?.creds?.me?.id || socket?.user?.id || '';

const resetWhatsAppSessionState = () => {
  whatsappSessionState.socket = null;
  whatsappSessionState.readyPromise = null;
};

const isRetryableSessionError = (reason = '') => {
  const normalized = String(reason || '').toUpperCase();
  return (
    normalized.includes('WHATSAPP_SESSION_CONNECTION_CLOSED') ||
    normalized.includes('WHATSAPP_SESSION_TIMEOUT') ||
    normalized.includes('WHATSAPP_SESSION_AUTH_TIMEOUT') ||
    normalized.includes('WHATSAPP_SESSION_RESTART_REQUIRED') ||
    normalized.includes('CONNECTION CLOSED')
  );
};

const getWhatsAppAuthDir = () =>
  process.env.WHATSAPP_AUTH_DIR || path.join(os.homedir(), '.yumyum-whatsapp-auth');

const clearWhatsAppAuthDir = () => {
  const authDir = getWhatsAppAuthDir();
  try {
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch (error) {
    // Ignore cleanup failures and let the reconnect proceed.
  }
  fs.mkdirSync(authDir, { recursive: true });
};

const shouldResetWhatsAppAuth = (error) => {
  const reason = String(error?.message || error || '').toUpperCase();
  return (
    reason.includes('WHATSAPP_SESSION_LOGGED_OUT') ||
    reason.includes('WHATSAPP_SESSION_CONNECTION_CLOSED') ||
    reason.includes('CONNECTION FAILURE') ||
    reason.includes('BADSESSION')
  );
};

const waitForSocketOpen = (socket) => {
  const timeoutMs = Number(process.env.WHATSAPP_CONNECT_TIMEOUT_MS || 120000);

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.ev.off('connection.update', handleUpdate);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleUpdate = (update) => {
      if (update.connection === 'open') {
        finishResolve();
        return;
      }

      if (update.connection === 'close') {
        const statusCode = update.lastDisconnect?.error?.output?.statusCode;
        if (statusCode === DisconnectReason.restartRequired) {
          finishReject(new Error('WHATSAPP_SESSION_RESTART_REQUIRED'));
          return;
        }

        if (statusCode === DisconnectReason.loggedOut) {
          finishReject(new Error('WHATSAPP_SESSION_LOGGED_OUT'));
          return;
        }

        finishReject(new Error('WHATSAPP_SESSION_CONNECTION_CLOSED'));
      }
    };

    const timer = setTimeout(() => {
      finishReject(new Error('WHATSAPP_SESSION_TIMEOUT'));
    }, timeoutMs);

    socket.ev.on('connection.update', handleUpdate);
  });
};

const waitForAuthenticatedSession = (socket) => {
  const timeoutMs = Number(process.env.WHATSAPP_CONNECT_TIMEOUT_MS || 120000);

  if (getSocketAuthId(socket)) {
    return Promise.resolve(socket);
  }

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.ev.off('creds.update', handleCredsUpdate);
      socket.ev.off('connection.update', handleConnectionUpdate);
    };

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(socket);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleCredsUpdate = () => {
      if (getSocketAuthId(socket)) {
        finishResolve();
      }
    };

    const handleConnectionUpdate = (update) => {
      if (update.connection === 'close') {
        finishReject(new Error('WHATSAPP_SESSION_CONNECTION_CLOSED'));
      }
    };

    const timer = setTimeout(() => {
      finishReject(new Error('WHATSAPP_SESSION_AUTH_TIMEOUT'));
    }, timeoutMs);

    socket.ev.on('creds.update', handleCredsUpdate);
    socket.ev.on('connection.update', handleConnectionUpdate);
  });
};

const initializeWhatsAppSocket = async () => {
  if (whatsappSessionState.socket) {
    return whatsappSessionState.socket;
  }

  if (whatsappSessionState.readyPromise) {
    return whatsappSessionState.readyPromise;
  }

  whatsappSessionState.readyPromise = (async () => {
    const createSocket = async () => {
      const authDir = getWhatsAppAuthDir();
      fs.mkdirSync(authDir, { recursive: true });

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      const socket = makeWASocket({
        version,
        auth: state,
        browser: Browsers.windows('Chrome'),
        markOnlineOnConnect: false,
        syncFullHistory: false
      });

      whatsappSessionState.socket = socket;

      socket.ev.on('creds.update', saveCreds);
      socket.ev.on('connection.update', (update) => {
        if (update.qr) {
          console.log('\nScan this WhatsApp QR code to connect Yum Yum:');
          qrcode.generate(update.qr, { small: true });
        }

        if (update.connection === 'close') {
          resetWhatsAppSessionState();
        }
      });

      await waitForSocketOpen(socket);
      return socket;
    };

    const maxAttempts = 3;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await createSocket();
      } catch (error) {
        const restartRequired = String(error?.message || '').includes('WHATSAPP_SESSION_RESTART_REQUIRED');

        if (restartRequired) {
          resetWhatsAppSessionState();
          continue;
        }

        if (shouldResetWhatsAppAuth(error)) {
          resetWhatsAppSessionState();
          clearWhatsAppAuthDir();
          continue;
        }

        throw error;
      }
    }

    throw new Error('WHATSAPP_SESSION_STARTUP_FAILED');
  })().catch((error) => {
    resetWhatsAppSessionState();
    throw error;
  });

  return whatsappSessionState.readyPromise;
};

const createPdfBuffer = (buildDoc) => {
  if (!PDFDocument) {
    return Promise.resolve(Buffer.from('PDF generation unavailable: install pdfkit'));
  }

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    buildDoc(doc);
    doc.end();
  });
};

const generateSaleReceiptPdf = async ({ wholesaleUser, saleEntry, summaryAfter }) => {
  return createPdfBuffer((doc) => {
    doc.fontSize(18).text('Yum Yum - Wholesale Receipt', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Receipt #: ${saleEntry.receiptNumber}`);
    doc.text(`Date: ${new Date(saleEntry.createdAt).toLocaleString()}`);
    doc.moveDown(0.5);

    doc.fontSize(12).text('Customer Details', { underline: true });
    doc.fontSize(10).text(`Name: ${wholesaleUser.name}`);
    doc.text(`Company: ${wholesaleUser.companyName || 'N/A'}`);
    doc.text(`WhatsApp: ${wholesaleUser.phone}`);
    doc.moveDown(0.8);

    doc.fontSize(12).text('Items', { underline: true });
    doc.moveDown(0.3);

    saleEntry.items.forEach((line, index) => {
      doc
        .fontSize(10)
        .text(
          `${index + 1}. ${line.itemName} | Qty: ${line.quantity} | Price: ${formatCurrency(line.unitPrice)} | Total: ${formatCurrency(line.lineTotal)}`
        );
    });

    doc.moveDown(0.8);
    doc.fontSize(11).text(`Sale Total: ${formatCurrency(saleEntry.amount)}`, { align: 'right' });
    doc.text(`Outstanding Pending: ${formatCurrency(summaryAfter.pendingAmount)}`, { align: 'right' });
    doc.moveDown(0.8);

    doc
      .fontSize(9)
      .fillColor('#666')
      .text('This is an automated receipt. Please contact admin for any corrections.', {
        align: 'center'
      });
  });
};

const generatePendingReminderPdf = async ({ wholesaleUser, summary, asOfDate }) => {
  return createPdfBuffer((doc) => {
    doc.fontSize(18).text('Yum Yum - Pending Amount Reminder', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`As of: ${asOfDate.toLocaleString()}`);
    doc.moveDown(0.5);

    doc.fontSize(12).text('Customer Details', { underline: true });
    doc.fontSize(10).text(`Name: ${wholesaleUser.name}`);
    doc.text(`Company: ${wholesaleUser.companyName || 'N/A'}`);
    doc.text(`WhatsApp: ${wholesaleUser.phone}`);
    doc.moveDown(0.8);

    doc.fontSize(12).text('Pending Summary', { underline: true });
    doc.fontSize(10).text(`Previous Pending: ${formatCurrency(summary.previousPending)}`);
    doc.text(`Today Sales Amount: ${formatCurrency(summary.todaySalesAmount)}`);
    doc.text(`Today Received Amount: ${formatCurrency(summary.todayReceivedAmount)}`);
    doc.moveDown(0.5);

    doc.fontSize(12).text(`Total Pending: ${formatCurrency(summary.pendingAmount)}`, {
      align: 'right'
    });

    doc.moveDown(1);
    doc
      .fontSize(9)
      .fillColor('#666')
      .text('Please clear the pending amount at the earliest. Thank you for your business.', {
        align: 'center'
      });
  });
};

const sendWhatsAppMessage = async ({ to, body }) => {
  const normalizedTo = normalizePhoneForSms(to);
  if (!normalizedTo) {
    return { sent: false, reason: 'INVALID_PHONE_NUMBER' };
  }

  let lastError = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const socket = await initializeWhatsAppSocket();

      if (!getSocketAuthId(socket)) {
        await waitForAuthenticatedSession(socket);
      }

      if (!getSocketAuthId(socket)) {
        return {
          sent: false,
          reason: 'WHATSAPP_SESSION_NOT_AUTHENTICATED (scan the QR code to complete pairing)'
        };
      }

      const jid = jidNormalizedUser(`${normalizedTo}@s.whatsapp.net`);

      await socket.sendMessage(jid, {
        text: body || ''
      });

      return {
        sent: true,
        transport: 'whatsapp-web'
      };
    } catch (error) {
      lastError = error;
      if (attempt === 0 && isRetryableSessionError(error?.message)) {
        resetWhatsAppSessionState();
        continue;
      }
      break;
    }
  }

  return {
    sent: false,
    reason: lastError?.message || 'WHATSAPP_SEND_FAILED'
  };
};

module.exports = {
  formatCurrency,
  generateSaleReceiptPdf,
  generatePendingReminderPdf,
  sendWhatsAppMessage,
  initializeWhatsAppSocket
};
