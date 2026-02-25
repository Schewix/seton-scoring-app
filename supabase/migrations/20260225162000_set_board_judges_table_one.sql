update public.board_judge_assignment
set table_number = 1
where user_id in (
  'f09924e2-b1e2-4898-9caf-839a2cc25ade'::uuid,
  'c5046125-b8d2-4c96-b7fc-d79cccffcfa5'::uuid
);
