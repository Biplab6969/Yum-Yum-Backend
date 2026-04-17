let cron = null;
try {
  cron = require('node-cron');
} catch (error) {
  cron = null;
}
const { runDailyPendingReminderJob } = require('../controllers/wholesaleController');

let reminderJob = null;

const initWholesaleReminderJob = () => {
  if (!cron) {
    console.warn('[Wholesale Reminder Job] node-cron not installed. Scheduler disabled.');
    return null;
  }

  if (reminderJob) {
    return reminderJob;
  }

  // Every day at 10:00 PM server time.
  reminderJob = cron.schedule('0 22 * * *', async () => {
    try {
      const results = await runDailyPendingReminderJob();
      const sent = results.filter((entry) => !entry.skipped).length;
      console.log(`[Wholesale Reminder Job] Completed. Sent: ${sent}, Total Checked: ${results.length}`);
    } catch (error) {
      console.error('[Wholesale Reminder Job] Failed:', error.message);
    }
  });

  return reminderJob;
};

module.exports = {
  initWholesaleReminderJob
};
