清点、位置、阈值与更正

先读取目标物品及关联业务记录。清点必须有实物数量，不能把附件数量直接当作实际库存。位置转移保留原业务历史，阈值明确数量和单位。关联多项操作使用 mixed，在一次完整预览后确认。撤销使用 undo 并查询原记录，存在后续依赖时解释业务服务器的拒绝原因，不能修改已经发生的历史。

修改备注使用 business_preview 的 kind metadata，payload 为 item_id 和 remark。不能用 stock adjust 修改备注。阈值使用 kind stock、action threshold、quantity，清点使用 action count、quantity、note。状态更换使用 action state、from_state、to_state、quantity。只修改教师明确要求的字段。
