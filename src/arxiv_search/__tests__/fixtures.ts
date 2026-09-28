/**
 * 测试夹具：手写的 arXiv Atom 响应样例（按官方格式裁剪，不是抓来的真响应）。
 *
 * 覆盖点：多作者 / 缺 affiliation / 多分类 / pdf link / 空结果 /
 * 标题摘要里的换行与多余空白。
 */

/** 两条 entry 的正常响应。 */
export const twoPaperFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <title type="html">ArXiv Query</title>
  <opensearch:totalResults>1187</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>2</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2409.00001v2</id>
    <updated>2024-09-03T01:02:03Z</updated>
    <published>2024-09-01T10:00:00Z</published>
    <title>Diffusion   Policy
      for Robot Manipulation</title>
    <summary>We propose a method.
      It runs on CPU only.</summary>
    <author>
      <name>Alice Zhang</name>
      <arxiv:affiliation>Tsinghua University</arxiv:affiliation>
    </author>
    <author>
      <name>Bob Li</name>
    </author>
    <arxiv:comment>Accepted at CoRL 2024</arxiv:comment>
    <arxiv:journal_ref>NeurIPS 2024</arxiv:journal_ref>
    <arxiv:doi>10.1000/xyz</arxiv:doi>
    <arxiv:primary_category term="cs.RO" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.RO" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
    <link href="http://arxiv.org/abs/2409.00001v2" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/2409.00001v2" rel="related" type="application/pdf"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2409.00002v1</id>
    <updated>2024-09-02T01:02:03Z</updated>
    <published>2024-09-02T01:02:03Z</published>
    <title>Sim-to-Real Transfer for Quadruped Locomotion</title>
    <summary>A short abstract.</summary>
    <author>
      <name>Carol Wu</name>
    </author>
    <arxiv:primary_category term="cs.RO" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.RO" scheme="http://arxiv.org/schemas/atom"/>
    <link href="http://arxiv.org/abs/2409.00002v1" rel="alternate" type="text/html"/>
  </entry>
</feed>`

/** 零结果：XML 合法、结构完整，只是没有 entry。 */
export const emptyFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <title type="html">ArXiv Query</title>
  <opensearch:totalResults>0</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>0</opensearch:itemsPerPage>
</feed>`

/** XML 合法但 entry 缺 <title>：结构对不上，应报 FeedDecodeError。 */
export const missingTitleFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">
  <opensearch:totalResults>1</opensearch:totalResults>
  <opensearch:startIndex>0</opensearch:startIndex>
  <opensearch:itemsPerPage>1</opensearch:itemsPerPage>
  <entry>
    <id>http://arxiv.org/abs/2409.00003v1</id>
    <summary>missing title</summary>
  </entry>
</feed>`

/** 压根不是 Atom：没有 <feed> 根节点（比如被代理拦了返回网页）。 */
export const notAtomDocument = `<html><body>blocked by proxy</body></html>`
