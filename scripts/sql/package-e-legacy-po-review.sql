-- Read-only rehearsal query. Run only on an authorized restored copy, after133.
-- A potential difference is NOT an allocation or an instruction to change debt.
BEGIN READ ONLY;
SELECT COUNT(*) AS manual_review_po_count,
  COUNT(DISTINCT supplier_id) AS manual_review_supplier_count,
  COALESCE(SUM(potential_difference),0) AS signed_potential_difference_in_minor_units
FROM public.phase133_legacy_po_payables_internal() WHERE needs_manual_review;
SELECT purchase_order_id,supplier_id,recorded_cost AS recorded_cost_in_minor_units,
  final_po_total AS final_po_total_in_minor_units,potential_difference AS potential_difference_in_minor_units,
  'يحتاج مراجعة يدوية' AS review_status
FROM public.phase133_legacy_po_payables_internal() WHERE needs_manual_review
ORDER BY supplier_id,purchase_order_id;
ROLLBACK;
