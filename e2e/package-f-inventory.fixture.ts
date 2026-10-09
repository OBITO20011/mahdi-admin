export const inventoryProducts = Array.from({length:24}, (_, index) => ({
  id: `88888888-8888-4888-8888-${String(index + 1).padStart(12,'0')}`,
  name_ar: ['عصير برتقال 250مل','مياه معدنية 600مل','شيبس جبنة 30غ','بسكويت بالشوكولاتة'][index % 4] + (index >= 4 ? ` · ${index + 1}` : ''),
  sku: `INV-${String(index + 1).padStart(4,'0')}`, barcode: `6251234500${String(index + 1).padStart(3,'0')}`,
  is_active: index !== 23, category_id:'drinks', is_flavor_master:false,
  units_per_purchase_unit:24, units_per_sale_unit:24,
  base_unit:{id:'packet',name_ar:'باكيت',code:'PKT'},
  purchase_unit:{id:'carton',name_ar:'كرتونة',code:'CTN'},sale_unit:{id:'carton',name_ar:'كرتونة',code:'CTN'},
  cost_price_in_minor_units:720, sale_price_in_minor_units:900, wholesale_price_in_minor_units:900,
  default_sale_price_in_minor_units:21600,default_purchase_price_in_minor_units:17280,
  on_hand_quantity:index === 3 ? 0 : index === 2 ? 46 : 100 + index,
  available_quantity:index === 3 ? 0 : index === 2 ? 46 : 100 + index,
  reserved_quantity:0,min_stock_level:48,max_stock_level:500,
  has_sales:true,movement_count:3,warehouse_id:'inventory-warehouse',
  warehouse_balances:[],created_at:'2026-10-01T06:00:00Z',updated_at:'2026-10-09T05:00:00Z',
}));
// Deliberately not sums of the displayed page: prove KPIs stay server-wide.
export const inventoryMetrics = {total_items:126,active_items:120,available_stock:124,total_cost_in_minor_units:18642300,
  total_retail_in_minor_units:23100000,low_stock:7,out_of_stock:2,stagnant:4};

export const inventoryMovementRows = inventoryProducts.flatMap(product => [
  {movement_type:'purchase_receipt',quantity:24,balance_before:80,balance_after:104,notes:'استلام بضاعة'},
  {movement_type:'sales_deduction',quantity:-3,balance_before:104,balance_after:101,notes:'بيع باكيتات'},
  {movement_type:'adjustment_subtract',reference_type:'stock_count',quantity:-1,balance_before:101,balance_after:100,notes:'مطابقة الجرد'},
].map((movement,index)=>({...movement,id:product.id+'-'+index,product_id:product.id,
  product_name:product.name_ar,branch_id:'inventory-branch',warehouse_id:'inventory-warehouse',
  created_by:'inventory-actor',created_at:'2026-10-09T05:00:00Z'})));
