-- The crypto cost assumption rose from 0.12% to 0.2% a trade (Binance's base taker fee, 0.1%, paid
-- on entry and exit). Every signal stored at the old 0.12% gets its cost recomputed from its own entry
-- and stop, so old and new rows count alike; gold (0.40 USD) and other symbols (0.10%) are untouched.
UPDATE "ledger_signals"
SET "cost_r" = 0.002 * "entry" / abs("entry" - "stop_loss")
WHERE "entry" <> "stop_loss" AND abs("cost_r" * abs("entry" - "stop_loss") / "entry" - 0.0012) < 0.000001;
