## Purpose

把「连接身份」绑定到集群本身而非承载它的文件路径：同一 kubeconfig 路径指向不同集群时身份必须改变，集群未变时身份必须稳定；使依赖该身份的持久清理责任不会在集群被替换后被错误地应用到新集群。

## ADDED Requirements

### Requirement: 连接身份必须绑定解析出的集群标识

连接指纹 SHALL 由 namespace 与解析出的集群标识（server 与证书颁发机构）确定性导出，MUST NOT 以 kubeconfig 路径或上下文名作为身份。当同一路径下的配置被替换为指向另一个集群时，指纹 MUST 改变；当集群标识未变时，指纹 MUST 稳定。

#### Scenario: 同路径换集群时身份改变

- **WHEN** 同一 kubeconfig 路径被替换为指向不同 server 的集群
- **THEN** 该连接的指纹与替换前不同

#### Scenario: 仅证书颁发机构不同时身份改变

- **WHEN** server 相同但证书颁发机构不同
- **THEN** 指纹不同

#### Scenario: 同一集群身份稳定

- **WHEN** 以相同集群标识重复构造连接
- **THEN** 指纹相同
