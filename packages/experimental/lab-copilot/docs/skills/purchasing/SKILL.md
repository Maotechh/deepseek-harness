采购草案、订购和到货

先查询 purchases 及关联 preparation。draft 仅记录需求，不表示已订购。已有草案时，place 使用查询到的 order_id 登记订购。没有现有草案而直接登记已订购时，使用 order，传入 item_id、quantity、unit、owner 和 expected_at。不能猜测 order_id。receive 同时登记实际到货与入库，支持部分到货且不得超过尚未到货数量。一次到货只生成一个 purchase/receive，不能再添加 stock/inbound，否则库存会重复增加。取消采购单独使用 purchase/cancel。到货后需要新的补充预留确认，不能自动更改已有实验分配。
