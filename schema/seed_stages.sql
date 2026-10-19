-- ============================================================================
--  Cold Call Coach — stage and outcome seed
--
--  GENERATED FILE — do not edit by hand.
--  Source: frontend/src/stageSheet.json
--  Regenerate: npm run seed:stages
--
--  Run after supabase_schema.sql in the Supabase SQL editor.
-- ============================================================================

insert into stages (
  number, key, name, purpose,
  caller_does, prospects_say, prospects_mean, tap_options,
  watch_out, median_seconds, exit_pct
)
values
  (1, 'opener', 'Open', 'Get a few seconds of attention and permission to keep talking, without sounding like a pitch.', '["Say the name and why you are calling in one breath","Pause and let them respond"]'::jsonb, '[{"line":"Who''s calling?","mean":"They are screening, not rejecting. Name the company, not the product."},{"line":"I''m in the middle of something.","mean":"Asking for a cost, not saying no. Offer a time cost of under a minute."}]'::jsonb, '[]'::jsonb, '["Kept me on the line","Asked who I am","Cut me off","Gave me a hard stop"]'::jsonb, 'Talking for more than 12 seconds before they have said a word.', 18, 4),
  (2, 'reason', 'Reason for the call', 'Say why them, why now, in one sentence they could repeat to a colleague.', '["Name something specific to their business","Keep it to one sentence"]'::jsonb, '[{"line":"How did you get my number?","mean":"They want provenance before content. Answer in five words and move on."},{"line":"We already have someone for that.","mean":"Open to the category, closed to a swap. Ask what they would change about it."}]'::jsonb, '[]'::jsonb, '["Listened","Went straight to an objection","Asked how I found them","Said they''re set"]'::jsonb, 'Describing your product instead of their situation.', 25, 9),
  (3, 'permission', 'Ask permission', 'Trade a question for a moment of their time so the rest of the call is theirs, not yours.', '["Ask a short, answerable question","Accept ''no'' gracefully if they will not give it"]'::jsonb, '[{"line":"You''ve got two minutes.","mean":"A real door. Honour it out loud and the next stage gets easier."},{"line":"Just tell me what it is.","mean":"They want the shape of it first. Give one line, then ask the question."}]'::jsonb, '[]'::jsonb, '["Said go ahead","Wanted the pitch first","Wouldn''t commit","Named a better time"]'::jsonb, 'Asking permission twice — the second one sounds like a script.', 15, 5),
  (4, 'discover', 'Find the problem', 'Get them to say the thing that is costing them, in their words, not yours.', '["Ask what is happening now","Ask what it costs them","Say nothing for four seconds after they answer"]'::jsonb, '[{"line":"We''re fine with how it works now.","mean":"Default answer. Ask what changed this year, or what they would fix if free."},{"line":"It''s not really a priority.","mean":"Priorities are about timing. Ask what would have to be true for it to become one."}]'::jsonb, '[]'::jsonb, '["Named a real problem","Said everything''s fine","Turned the question back","Wouldn''t engage"]'::jsonb, 'Jumping to the pitch the moment they mention any discomfort.', 70, 14),
  (5, 'reframe', 'Reframe', 'Connect their problem to a way of fixing it, so your product arrives as an answer rather than a pitch.', '["Repeat their words back","Offer one outcome, not five features"]'::jsonb, '[{"line":"What does it cost?","mean":"They are close enough to price it. Give a range and ask if that is in range."},{"line":"Send me an email.","mean":"Sometimes a brush-off, sometimes real. Ask what line in the email would make them open it."}]'::jsonb, '[]'::jsonb, '["It landed","Asked about price","Asked for an email","Didn''t see the link"]'::jsonb, 'A feature list. One problem, one outcome, one number.', 45, 8),
  (6, 'objections', 'Handle the pushback', 'Let the objection be said fully, then answer the actual one instead of the one you expected.', '["Let them finish the sentence","Name the objection out loud before answering it"]'::jsonb, '[{"line":"Now isn''t a good time.","mean":"About today, not the product. Ask when a good time is and mean it."},{"line":"We don''t have budget.","mean":"Often a priority statement. Ask what would justify the budget rather than cutting the number."}]'::jsonb, '[]'::jsonb, '["Came back in","Stood firm","Raised a second objection","Went quiet on me"]'::jsonb, 'Answering the objection before they have finished saying it.', 55, 18),
  (7, 'proof', 'Prove it', 'Give one piece of evidence they can check, sized to the thirty seconds you have left.', '["Use one comparable customer or number","Offer the proof in the follow-up, not the pitch"]'::jsonb, '[{"line":"Who else uses it?","mean":"They are testing whether you are real. One name beats three logos."},{"line":"I''d have to look into it.","mean":"They have no reason to believe the effort is theirs. Offer to send the two things they would look at."}]'::jsonb, '[]'::jsonb, '["Believed it","Asked for references","Wanted proof of numbers","Still unsure"]'::jsonb, 'Promising a case study you then fail to send.', 40, 6),
  (8, 'close', 'Ask for the meeting', 'Convert the conversation into a next step with a day and a time attached to it.', '["Ask for a specific slot","Confirm it before you hang up"]'::jsonb, '[{"line":"What do I need to do?","mean":"They want the mechanics. Answer with a calendar move, not a website link."},{"line":"I''ll think about it.","mean":"Rarely means yes. Offer the smallest next step: ten minutes, their calendar, this week."}]'::jsonb, '[]'::jsonb, '["Booked a meeting","Asked me to follow up","Said no","Ran out of time"]'::jsonb, 'Ending on ''I''ll follow up'' with no date attached to either side.', 35, 15)
on conflict (number) do update set
  key            = excluded.key,
  name           = excluded.name,
  purpose        = excluded.purpose,
  caller_does    = excluded.caller_does,
  prospects_say  = excluded.prospects_say,
  prospects_mean = excluded.prospects_mean,
  tap_options    = excluded.tap_options,
  watch_out      = excluded.watch_out,
  median_seconds = excluded.median_seconds,
  exit_pct       = excluded.exit_pct,
  updated_at     = now();

-- The outcome list the caller picks from when they close a call.
insert into outcomes (key, label, tone, meta)
values
  ('meeting_booked', 'Meeting booked', 'good', 'A slot was agreed before the call ended.'),
  ('follow_up_agreed', 'Follow-up agreed', 'warm', 'They asked to be contacted, with no meeting set.'),
  ('not_now', 'Not right now', 'warm', 'Interested, wrong moment. Worth a dated retry.'),
  ('not_a_fit', 'Not a fit', 'bad', 'Company, size or need does not match what you sell.'),
  ('wrong_person', 'Wrong person', 'bad', 'Someone else owns this. Ask for the name before you hang up.'),
  ('refused', 'Refused outright', 'bad', 'Ended the call. Do not dial this number again this quarter.'),
  ('no_answer', 'No answer / voicemail', 'bad', 'Reached nobody. The stage trail stops where it stopped.')
on conflict (key) do update set
  label = excluded.label,
  tone  = excluded.tone,
  meta  = excluded.meta;
