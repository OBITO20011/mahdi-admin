# Business Alert Rules

The existing Business outbox, Telegram delivery, incident deduplication, and
recovery state machine remain authoritative. These rules do not create a new
monitoring channel and never mutate operational state automatically.

- Delayed order: an order in `new`, `confirmed`, `preparing`, `ready`, or
  `out_for_delivery` is delayed at 120 minutes from database `created_at`.
  Terminal orders (`completed`, `cancelled`, `returned`, `expired`) are not
  delayed. One incident is opened and repeated scans are deduplicated; moving
  to a terminal state resolves it through the existing recovery event.
- Cash difference: every non-zero `cash_discrepancy_in_minor_units`, positive
  or negative, is flagged in the existing one-per-shift closing event. Zero is
  balanced. Positive is `surplus`; negative is `shortage`. There is no minimum
  monetary threshold.
- Daily expenses: reporting uses the `Asia/Amman` calendar day from local
  midnight inclusive to the next local midnight exclusive. It is not a rolling
  24-hour window and never opens an amount-threshold alert.
- Shift closing: the maximum close instant is the earlier of 15 elapsed hours
  after `opened_at` and the next `Asia/Amman` midnight for the opening date.
  An overdue open shift creates one deduplicated alert. Closing it resolves the
  incident. Monitoring never closes a shift or changes its accounting totals.

Business Telegram delivery and its recipient remain unchanged.
