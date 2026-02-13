import express from 'express';
import cors from 'cors';
import authRouter, { manifestHandler } from './auth.js';
import syncRouter from './sync.js';
import adminRouter from './admin.js';
import { env } from './env.js';

const app = express();

const corsOrigin = env.CORS_ORIGIN?.trim();

app.use(
  cors(
    corsOrigin
      ? {
          origin: corsOrigin,
          credentials: true,
        }
      : undefined,
  ),
);
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
