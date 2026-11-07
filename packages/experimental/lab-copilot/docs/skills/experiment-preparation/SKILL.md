完整实验准备

读取选定附件，整理名称、规格、单位和来源。确认人数、每组人数、开始及结束时间、消耗或借用方式。使用 preparation 一次规划完整任务，per_person、per_group、fixed、spare 均由业务服务器精确计算。多位置分别分配。规格和换算不明时追问。数量不足仍预留可用数量并保存未满足需求与采购草案。需要修改人数或条目时重新生成整项预览。预留不表示实际取用，实验执行另行登记 consume 或 borrow。到货后使用 preparation_update replenish 预览新的分配，不能自动分配。

preparation 自动生成未满足数量的采购草案，不能再添加重复 purchase draft 操作。一次完整准备只调用一次 business_preview。
