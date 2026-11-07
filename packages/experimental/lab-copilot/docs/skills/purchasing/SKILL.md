采购草案、订购和到货

先查询 purchases 及关联 preparation。draft 仅记录需求，不表示已订购。已有草案时，place 使用查询到的 order_id 登记订购。没有现有草案而直接登记已订购时，使用 order，传入 item_id、quantity、unit、owner 和 expected_at。不能猜测 order_id。receive 只登记实际到货，支持部分到货且不得超过尚未到货数量。分别预览并确认取消、到货及入库。到货后需要新的补充预留确认，不能自动更改已有实验分配。
