# KnowSearch
1. 浏览器插件监听访问的页面，页面内容传递给本地服务
2. 本地python服务，接收页面内容，url，触发条件等，存库
3. 本地python服务调用embed模型，存储
4. 本地python服务提供计算相似度和检索的服务，返回topK结果