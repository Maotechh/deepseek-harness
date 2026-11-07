完整实验准备

读取选定附件，整理名称、规格、单位和来源。确认人数、每组人数、开始及结束时间、消耗或借用方式。使用 preparation 一次规划完整任务，per_person、per_group、fixed、spare 均由业务服务器精确计算。多位置分别分配。规格和换算不明时追问。数量不足仍预留可用数量并保存未满足需求与采购草案。需要修改人数或条目时重新生成整项预览。预留不表示实际取用，实验执行另行登记 consume 或 borrow。到货后使用 preparation_update replenish 预览新的分配，不能自动分配。

preparation 自动生成未满足数量的采购草案，不能再添加重复 purchase draft 操作。一次完整准备只调用一次 business_preview。

修改已有准备的人数、时间或条目使用 preparation_update/revise；补充预留使用 preparation_update/replenish。取消整项准备使用 preparation_update/cancel，服务器同时解除全部关联预留并取消尚未订购的草案，不得只取消某个采购草案而保留原准备。已订购记录继续保留。已有预留实际取用时查询 schedules 并使用 execute_schedule，服务器按照原安排分别登记消耗和借用，不能再添加重复 stock 操作。
