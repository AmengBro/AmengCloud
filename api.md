
#api接口说明文件如下：
###列表 API：
-接口说明:获取表格中的记录列表，支持分页、排序和筛选。
-请求方法:http  GET /api/v1/bases/{base_id}/tables/{table_name}/records
-路径参数描述
-base_id string 数据库 ID
-table_name string 表格名称
-查询参数
page      number  页码，默认为 1
limit     number  每页记录数，默认为 15
filters     string  筛选条件
filters的格式说明（字段需要加双引号）：
{
                    "meetdate": reservation.date,  // 预约日期
                    "guanshiid": reservation.roomId,  // 会议室ID（馆室ID）
                    "start": startDateTime,  // 开始时间（完整格式）
                    "end": endDateTime,  // 结束时间（完整格式）
                    "username": reservation.reserver,  // 预约人
                    "name": reservation.purpose,  // 预约人姓名
                }
-请求头：x-bm-token: your_api_token
-基础查询：GET /api/bases/base123/tables/table456/records
-分页查询：GET /api/bases/base123/tables/table456/records?page=2&limit=10
-筛选查询：GET /api/bases/base123/tables/table456/records?filters=W1sid2hlcmUiLCBbImFnZSIsICI+IiwgMThdXV0=
-相应格式：
{  "current_page": 1,  "data": [    // records  ],  "per_page": 15,  "total": 10,  "last_page": 1,  "count": 10}
-筛选条件
筛选条件是一段把条件数组使用 base64 编码后的字符串。 每个条件包含两个元素：操作符和操作对象。
where   添加筛选条件
orderBy添加排序条件
select添加字段选择
with添加关联字段
withCount添加关联聚合
-操作对象
"="  等于  ["where", ["age", "=", 18]]
"!="  不等于  ["where", ["age", "!=", 18]]
">"  大于  ["where", ["age", ">", 18]]
">="  大于等于  ["where", ["age", ">=", 18]]
"<"  小于  ["where", ["age", "<", 18]]
"<="  小于等于  ["where", ["age", "<=", 18]]
"in" 在列表中["where", ["status", "in", ["active", "pending"]]]
"notin"不在列表中["where", ["status", "notin", ["deleted"]]]
"like"包含["where", ["name", "like", "test"]]
"notlike"不包含["where", ["name", "notlike", "test"]]
"isNull"为空["where", ["description", "=", null]]
"isNotNull"不为空["where", ["description", "!=", null]]
-base64 编码：// SELECT * FROM users// WHERE age > 18;const encoded = btoa(JSON.stringify([  ["where", ["age", ">", 18]]]));
-条件：// SELECT * FROM users// WHERE age > 18 AND status = 'active';const encoded = btoa(JSON.stringify([  ["where", ["age", ">", 18]],  ["where", ["status", "=", "active"]]]));
-排序：// SELECT * FROM users// ORDER BY age DESC;const encoded = btoa(JSON.stringify([  ["orderBy", ["age", "desc"]]]));
-字段选择：// SELECT name, age FROM users;const encoded = btoa(JSON.stringify([  ["select", ["name", "age"]]]));
-关联关系：const encoded = btoa(JSON.stringify([  ["with", ["posts:id,title"]],  ["with", ["comments"]],]));
-关联聚合：const encoded = btoa(JSON.stringify([  ["withCount", ["posts"]]]));
-复合条件：const encoded = btoa(JSON.stringify([  ["select", ["id", "title", "description"]],  ["with", ["author:id,name"]],  ["withCount", ["comments", [    ["where", ["status", "=", "active"]]  ]]],  ["where", ["vote", ">", 10]],  ["orderBy", ["votes", "desc"]]]));fetch(`/api/v1/bases/base123/tables/posts/records?filters=${encoded}`)
-注意事项
1每页最大记录数为 100
2复杂的筛选条件可能会影响查询性能
3关联字段的数据需要使用专门的查询参数获取


###详情 API
本文档介绍如何使用 API 获取表格中的单条记录详情。
接口说明：获取表格中指定记录的详细信息。
-请求方法 http GET /api/bases/{base_id}/tables/{table_name}/records/{record_id}
-路径参数：
base_id数据库 ID
table_name表格名称
record_id记录 ID
查询参数
参数fields   类型string  描述：要返回的字段列表，用逗号分隔
-请求头 http x-bm-token: your_api_token
-示例请求：
-基础查询 http  GET /api/bases/base123/tables/table456/records/rec789
指定字段 http GET /api/bases/base123/tables/table456/records/rec789?fields=id,name,created_at
-响应格式
-成功响应：json格式 {  "id": "11",  "name": "test",  "created_by": "usrIL1t20OwVvW9jXzT",  "updated_by": "usrIL1t20OwVvW9jXzT",  "created_at": "2024-11-20T17:30:12.000Z",  "updated_at": "2024-11-20T17:30:27.000Z",  "creator": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  },  "modifier": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  }}
-错误响应 json格式：{  "message": "Record not found",}

-字段类型说明
不同类型字段的返回格式：
-基础类型 json   {  "text_field": "文本内容",  "number_field": 123.45,  "boolean_field": true,  "date_field": "2023-01-01T00:00:00Z"}
-选项类型json {  "single_select": "选项1",  "multiple_select": [    "选项1",    "选项2"  ]}
-关联类型json {  "single_link": {    "id": "rec123",    "name": "关联记录"  },  "multiple_link": [    {      "id": "rec123",      "name": "关联记录1"    },    {      "id": "rec456",      "name": "关联记录2"    }  ]}
创建者  json{  "created_by": "usrIL1t20OwVvW9jXzT",  "creator": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  }}
更新者  json  {  "updated_by": "usrIL1t20OwVvW9jXzT",  "modifier": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  }}
-注意事项
--如果记录不存在，将返回 404 错误

###创建 API
本文档介绍如何使用 API 在表格中创建新记录。
-接口说明：在指定表格中创建一条新记录。
-请求方法 http POST /api/bases/{base_id}/tables/{table_name}/records
-路径参数
base_id数据库 ID string
table_name表格名称 string
-请求头http x-bm-token: your_api_tokenContent-Type: application/json
请求体 json
{  "fields": {    "field_name1": "value1",    "field_name2": "value2"  }}
-示例请求
-基础字段创建 http POST /api/bases/base123/tables/table456/recordsContent-Type: application/json{  "id": 156,  "name": "测试记录",  "description": "这是一条测试记录",  "age": 25,  "is_active": true}
选项字段创建 http POST /api/bases/base123/tables/table456/recordsContent-Type: application/json{  "status": "opt123",  // 单选字段使用选项 ID  "tags": ["opt456", "opt789"]  // 多选字段使用选项 ID 数组}
响应格式
成功响应 json {  "id": "11",  "name": "test",  "created_by": "usrIL1t20OwVvW9jXzT",  "updated_by": "usrIL1t20OwVvW9jXzT",  "created_at": "2024-11-20T17:30:12.000Z",  "updated_at": "2024-11-20T17:30:27.000Z",  "creator": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  },  "modifier": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  }}
-错误响应 json {  "message": "Validation failed",}
-字段值格式说明
不同类型字段的请求格式：
-基础类型 json {  "text_field": "文本内容",  "number_field": 123.45,  "boolean_field": true,  "date_field": "2023-01-01T00:00:00Z"}
-选项类型 json {  "single_select": "opt123",  // 选项 ID  "multiple_select": ["opt123", "opt456"]  // 选项 ID 数组}
-关联类型 json{  "single_link": "rec123",  // 记录 ID  "multiple_link": ["rec123", "rec456"]  // 记录 ID 数组}
-注意事项
1创建记录时会自动填充以下字段：
a创建时间
b更新时间
c创建者
d更新者
e自增 ID（如果有）

###更新 API
本文档介绍如何使用 API 更新表格中的记录。
-接口说明：更新表格中指定记录的字段值。
-请求方法 http PATCH /api/bases/{base_id}/tables/{table_name}/records/{record_id}
-路径参数
base_id 数据库 ID string
table_name 表格名称 string
record_id 记录 ID string
-请求头http  x-bm-token: your_api_tokenContent-Type: application/json
-请求体json {  "field_name1": "new_value1",  "field_name2": "new_value2"}
-示例请求
-基础字段更新 http PATCH /api/bases/base123/tables/table456/records/rec789
Content-Type: application/json{  "name": "更新后的名称",  "description": "这是更新后的描述",  "age": 26,  "is_active": false}
响应格式
-成功响应 json {  "id": "11",  "name": "55po",  "created_by": "usrIL1t20OwVvW9jXzT",  "updated_by": "usrIL1t20OwVvW9jXzT",  "created_at": "2024-11-20T17:30:12.000Z",  "updated_at": "2024-11-20T17:30:27.000Z",  "avatar": null,  "creator": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  },  "modifier": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  }}
-错误响应 json {  "message": "Validation failed"}
-字段值格式说明
不同类型字段的更新格式：
基础类型json {  "text_field": "新的文本内容",  "number_field": 456.78,  "boolean_field": false,  "date_field": "2023-02-01T00:00:00Z"}
选项类型 json {  "single_select": "opt789",  // 新的选项 ID  "multiple_select": ["opt111", "opt222"]  // 新的选项 ID 数组}
关联类型 json {  "single_link": "rec999",  // 新的记录 ID  "multiple_link": ["rec111", "rec222"]  // 新的记录 ID 数组}
-注意事项
创建时间、创建者、自增 ID无法通过 API 更新：

###删除 API
本文档介绍如何使用 API 删除表格中的记录。
-接口说明：删除表格中的指定记录。
-请求方法 http DELETE /api/bases/{base_id}/tables/{table_name}/records/{record_id}
-路径参数
base_id 数据库 ID string
table_name 表格名称 string
record_id 记录 ID string
-请求头 http x-bm-token: your_api_token
示例请求
删除单条记录 http  DELETE /api/bases/base123/tables/table456/records/rec789
响应格式
-成功响应
json
{  "id": "11",  "name": "删除的记录",  "created_by": "usrIL1t20OwVvW9jXzT",  "updated_by": "usrIL1t20OwVvW9jXzT",  "created_at": "2024-11-20T17:30:12.000Z",  "updated_at": "2024-11-20T17:30:27.000Z",  "creator": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  },  "modifier": {    "id": "usrIL1t20OwVvW9jXzT",    "email": "dylan@basemulti.com",    "name": "Dylan"  }}
-错误响应json
{  "message": "Record not found"}
-注意事项
1删除记录是不可逆操作，请谨慎使用
2如果记录不存在，将返回 404 错误
3删除记录可能会影响其他表中的关联字段
