# credential-safe-display (delta)

## ADDED Requirements

### Requirement: 凭证脱敏对多行文本同样生效

结构化可识别的 URL / scp 凭证脱敏 SHALL 对含换行的输入同样生效：实现 MUST 按行脱敏后以原分隔符重组，MUST NOT 因为输入含换行而整体放行。行结构与原分隔符（`\n` / `\r\n` / `\r`）MUST 保持不变，使读者看到的消息形态不因脱敏而改变。

理由记录在合同里，避免日后被当作性能优化再次去掉：宿主写入事实源的唯一错误文本通道是先脱敏后截断的 `boundedOutcome`，而 git 与子进程失败的 stderr 几乎总是多行、且常常带着它失败于其上的远端地址。整体放行意味着**最常见的一种带凭证文本恰好是唯一不被脱敏的那一种**。

#### Scenario: 多行 git 失败消息中的凭证被移除

- **WHEN** 脱敏一段包含两行、每行各带一个 `https://user:token@host/owner/repo.git` 的失败消息
- **THEN** 输出不含该 token，两行的主机与路径仍然可读，且行数不变

#### Scenario: 同一条消息单行与多行结果一致

- **WHEN** 同一段带凭证的文本分别以单行与多行形式脱敏
- **THEN** 两者都不含原始凭证；实现 MUST NOT 只在其中一种形式下生效
