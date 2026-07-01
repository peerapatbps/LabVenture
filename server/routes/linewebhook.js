const express = require('express');
const router = express.Router();

router.post('/', (req, res) => {
  const events = req.body?.events || [];
  for (const event of events) {
    const src = event.source;
    if (src?.type === 'group') {
      console.log('\n========================================');
      console.log('✅ LINE GROUP ID พบแล้ว:');
      console.log('   groupId =', src.groupId);
      console.log('========================================\n');
    }
    console.log('[LINE webhook]', JSON.stringify(event, null, 2));
  }
  res.json({ ok: true });
});

module.exports = router;
