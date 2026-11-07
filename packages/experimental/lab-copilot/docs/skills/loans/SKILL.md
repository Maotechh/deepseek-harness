借用、归还与消耗

先查询物品及 workflow_query loans。消耗永久减少拥有量，借用仅改变所在状态。归还必须引用原 loan_id，支持部分归还，并明确 ready、cleaning、damaged 或 lost。待清洗的物品经 state 计划变为 ready 后才可再用。每次变更使用 business_preview，教师确认前不得声称完成。
