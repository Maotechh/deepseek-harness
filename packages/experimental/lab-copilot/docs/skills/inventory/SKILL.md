耗材查询、入库、消耗与历史导出

先使用 inventory_search 查询名称、规格、实验室、位置和状态。需要实验时间内的可用量时传入明确的 starts_at、ends_at。不得把总拥有数量当作可用数量。多种规格分别展示。历史使用 history_search，导出使用 export_inventory。查询不产生业务修改。

教师明确说明实际新增入库时，查询目标物品后使用 business_preview，kind 为 stock，payload 为 item_id、action inbound、quantity 和 unit。教师报告的实际操作是登记依据，不能要求历史中已经存在同一笔入库。消耗使用 action consume。查询已确定物品且资料完整时立即生成预览，不需要重复搜索其他无关记录。实验室名称与柜子位置分开理解，A1 等位置不能作为 lab 条件。

位置转移使用 transfer。目标是同一实验室的 B1 柜子时，target_lab 保持已查询的 lab，target_location 为 B1。不能把实验室与柜子拼接成新的实验室名称；目标含义不明确时先追问。
