import express from 'express';
import cors from 'cors';
import authRouter, { manifestHandler } from './auth.js';
import syncRouter from './sync.js';
import adminRouter from './admin.js';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRouter);

app.get('/manifest', manifestHandler);

app.use(syncRouter);
app.use('/admin', adminRouter);

const port = Number(process.env.PORT || 8787);

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
