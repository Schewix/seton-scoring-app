import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import changePasswordHandler from '../../../api/auth/change-password';
import loginHandler from '../../../api/auth/login';
import { hashPassword } from '../../../api-lib/auth/password-utils';
import { resetTestData, seedBase, supabaseAdmin } from './supabaseTestUtils';

function createMockRes() {
  const res: any = {};
  res.statusCode = 200;
  res.headers = {};
  res.setHeader = (key: string, value: string) => {
    res.headers[key] = value;
    return res;
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.payload = payload;
    return res;
  };
  res.end = () => res;
  return res;
}

describe('change-password api', () => {
  let ctx: Awaited<ReturnType<typeof seedBase>>;
  const oldPassword = 'OldPass123!';
  const newPassword = 'NewPass123!';

  beforeEach(async () => {
    if (ctx) {
      await resetTestData(ctx);
    }
    ctx = await seedBase();
    const initialHash = await hashPassword(oldPassword);
    await supabaseAdmin
      .from('judges')
      .update({ password_hash: initialHash, must_change_password: false })
      .eq('id', ctx.judgeId);
  });

  afterAll(async () => {
    if (ctx) {
      await resetTestData(ctx);
    }
  });

  it('changes own password using bearer token and snake_case payload', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: {
        current_password: oldPassword,
        new_password: newPassword,
      },
    };
    const res = createMockRes();

    await changePasswordHandler(req, res);
    expect(res.statusCode).toBe(200);

    const judgeEmail = `judge-${ctx.judgeId}@example.com`;
    const loginReq: any = {
      method: 'POST',
      body: { email: judgeEmail, password: newPassword },
    };
    const loginRes = createMockRes();
    await loginHandler(loginReq, loginRes);
    expect(loginRes.statusCode).toBe(200);
    expect(typeof loginRes.payload?.access_token).toBe('string');
  });

  it('accepts JSON string body for authenticated self-change payload', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: JSON.stringify({
        current_password: oldPassword,
        new_password: newPassword,
      }),
    };
    const res = createMockRes();

    await changePasswordHandler(req, res);
    expect(res.statusCode).toBe(200);
  });

  it('rejects wrong current password for authenticated self-change', async () => {
    const req: any = {
      method: 'POST',
      headers: { authorization: `Bearer ${ctx.accessToken}` },
      body: {
        current_password: 'WrongCurrentPassword',
        new_password: newPassword,
      },
    };
    const res = createMockRes();

    await changePasswordHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.payload?.error).toBe('Current password is incorrect');
  });

  it('keeps legacy id + newPassword payload working', async () => {
    const req: any = {
      method: 'POST',
      body: {
        id: ctx.judgeId,
        newPassword,
      },
    };
    const res = createMockRes();

    await changePasswordHandler(req, res);
    expect(res.statusCode).toBe(200);
  });
});
