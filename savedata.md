# AmengCloud 文件存储逻辑
前情提要：由于新的分片存储逻辑，所以files表的base64字段存储的是分片ID列表（JSON数组格式），而不是旧格式base64字符串，如果文件中提到“file表的data字段”，则指的是“base64”字段。
## 数据库配置

- **API Key**: `PZs9PbId3FAWJkcSqauwQ3pA9Elcxj7LDMW6ddnQ`
- **数据库地址**: `https://data.520ai.cc`
- **基础ID**: `bseloUQsS6clyMZgVMK`

## 表格说明

### 1. 用户表 (Users)
- **表格ID**: `AnIpKe3pqF`
- **URL**: https://data.520ai.cc/bases/bseloUQsS6clyMZgVMK/tables/AnIpKe3pqF
- **字段**:
  - `Username`: 用户名
  - `owned_file`: 用户拥有的文件ID列表（JSON数组格式，如 `[4,5,7,8,9,10]`）
  - `password`: 密码

### 2. 文件数据表 (Files)
- **表格ID**: `x0612PXRor`
- **URL**: https://data.520ai.cc/bases/bseloUQsS6clyMZgVMK/tables/x0612PXRor
- **字段**:
  - `name`: 文件名
  - `base64`: 文件内容（base64编码）或标记值
  - `sha256`: SHA256校验码
  - `floder`: 所属文件夹ID（0表示根目录）
  - `base64`: 分片存储位置（JSON数组格式，存储分片ID列表）或旧格式base64字符串

### 3. 分片存储表 (Chunks)
- **表格ID**: `lPC8BdINUq`
- **URL**: https://data.520ai.cc/bases/bseloUQsS6clyMZgVMK/tables/lPC8BdINUq
- **字段**:
  - `name`: 分片数据（base64编码）

## 文件存储逻辑

### 存储流程（统一分片存储）

**所有文件都使用分片存储**，无论大小。

```
文件 → Base64编码 → 本地暂存 → 分割为2.88MB分片 → 分片存储到Chunks表 → 分片ID列表存储到Files表的base64字段
```

**分片大小**: 3029309字节 (约2.88MB)

**具体步骤**:
1. 将文件转换为Base64字符串
2. 将Base64字符串暂存到本地
3. 分割为2.88MB的分片
4. 每个分片上传到Chunks表，得到分片ID
5. 将分片ID列表（JSON数组）存储到Files表的`base64`字段
6. Files表的`base64`字段标记为`"chunked"`

### 文件夹创建
```
文件夹名称 → 创建Files记录（base64="floder", sha256="floder", data=null）
```

### 下载流程

#### 1. 分片存储文件（新格式）
```
Files表读取base64字段（JSON数组） → 依次从Chunks表读取分片 → 拼接Base64字符串 → Base64解码 → 文件
```

#### 2. 旧格式文件（兼容）
```
Files表读取data字段 → 判断是否为JSON数组
  - 如果是JSON数组：按分片存储处理
  - 如果不是JSON（是base64字符串）：直接使用base64字段解码
```

### 旧文件兼容判断逻辑

```
判断依据：Files表的data字段
  - data字段是JSON数组格式 → 分片存储文件
  - base64字段是base64字符串格式 → 旧格式文件，直接使用base64字段
  - base64有值且不是json → 旧格式文件，直接使用base64字段
  - ”base64“字段="floder" → 文件夹
```

## 用户权限

### Administrator用户
- 可以访问所有文件
- owned_file字段实时更新以确保访问所有文件

### 普通用户
- 只能访问owned_file中包含的文件
- 上传文件或创建文件夹后，自动将新项目ID添加到owned_file

## API请求格式

### 创建记录 (POST)
```json
{
  "name": "文件名",
  "base64": "chunked",
  "sha256": "校验码",
  "floder": 所属文件夹ID,
  "data": "[分片ID列表JSON]"
}
```

### 创建文件夹
```json
{
  "name": "文件夹名",
  "base64": "floder",
  "sha256": "floder",
  "floder": 所属文件夹ID,
  "data": null
}
```

### 获取记录 (GET)
响应格式：
```json
{
  "id": 记录ID,
  "name": "文件名",
  "base64": "chunked或base64字符串",
  "data": "[分片ID列表]或base64字符串",
  "floder": 0,
  "created_by": "创建者ID",
  "updated_by": "更新者ID",
  "created_at": "创建时间",
  "updated_at": "更新时间"
}
```

### 更新记录 (PATCH)
```json
{
  "owned_file": "[文件ID列表]"
}
```

## 分片存储详细流程

### 上传流程图
```
用户选择文件
    ↓
读取文件为ArrayBuffer
    ↓
转换为Base64字符串
    ↓
本地暂存Base64
    ↓
分割为2.88MB分片 [chunk1, chunk2, chunk3, ...]
    ↓
逐个上传分片到Chunks表
    ↓
获取分片ID [id1, id2, id3, ...]
    ↓
上传文件记录到Files表
    ↓
”base64“字段存储 [id1, id2, id3, ...]
    ↓
将文件ID添加到用户owned_file
    ↓
完成
```

### 下载流程图
```
读取Files表记录
    ↓
检查data字段格式
    ↓
┌─ JSON数组（分片格式）─┐    ┌─ 非JSON（旧格式）─┐
↓                       ↓    ↓                   ↓
解析为分片ID列表        直接使用base64字段
    ↓                       ↓
遍历ID列表              ↓
    ↓                       ↓
获取每个分片            ↓
    ↓                       ↓
拼接Base64              ↓
    ↓                       ↓
Base64解码              Base64解码
    ↓                       ↓
保存文件                保存文件
```
