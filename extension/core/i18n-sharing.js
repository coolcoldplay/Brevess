(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.SciLLM?.registerInterfaceTranslations?.(api.entries,api.patterns);})(globalThis,function(){
  'use strict';
  const entries=Object.fromEntries(`BREVESS · 共享中心	BREVESS · Sharing center
账号	Account
账号管理	Account management
未登录	Not signed in
已登录	Signed in
管理登录、邮箱、密码和课题组，插件各模块共用登录状态。	Manage sign-in, email, password and research groups. All extension modules share your sign-in.
正在加载账号管理…	Loading account management…
账号管理暂时无法加载，请刷新设置页重试。	Account management could not load. Reload Settings to try again.
正在核验登录状态…	Checking sign-in status…
暂时无法核验登录状态	Sign-in status unavailable
登录 / 注册	Sign in / Register
请重新登录	Please sign in again
账号与课题组	Account and research groups
BREVESS · 账号与课题组	BREVESS · Account and research groups
注册 / 登录	Register / Sign in
高级设置 · 服务连接	Advanced settings · Service connection
在这里注册、登录和管理账号，创建课题组或接受邀请。插件内各模块共用登录状态。	Register, sign in, manage your account, create a research group or accept invitations here. All extension modules share your sign-in.
管理后台	Administration
BREVESS 用户	BREVESS user
共享服务不可用；本次修改未确认生效。	The sharing service is unavailable. This change has not been confirmed.
Panel 笔记	Panel note
Panel 规划	Panel plan
Panel 讨论	Panel discussion
Panel 首条评论	First Panel comment
不上传整篇论文、截图、附件、本机路径或来源快照。父条目共享不会自动共享关联条目。取消共享无法收回别人此前已阅读或复制的内容。	Full papers, screenshots, attachments, local paths and source snapshots are not uploaded. Sharing a parent does not share linked items. Withdrawal cannot recall content already read or copied.
不支持此共享内容类型	This content type cannot be shared
与下一张图的逻辑	Connection to the next figure
主线	Main path
人工参考说明	Authored reference notes
人工证据判断	Authored evidence assessment
仅个人可见	Private
仅作者与所选课题组的当前成员可读；成员退出或被移出后失去访问。	Only the author and current members of the selected group can read this. Leaving or removal revokes access.
仅所选课题组成员	Selected group members only
作者	Author
作者编辑，课题组成员阅读。仅个人可见是旧记录与新记录的默认值；共享不会改动本机原文和来源定位。	Authors edit; group members read. Existing and new records are private by default. Sharing keeps local content and source anchors unchanged.
作者范围	Authors
作者请从原备注或工作台入口修改内容与可见性；本页不会把服务内容覆盖回本地记录。	Authors can edit content and visibility from the original note or workbench. This page does not overwrite local records with shared content.
你已不属于所选课题组，不能读取该范围的讨论。	You are no longer a member of the selected group and cannot read its discussions.
保存可见性	Save visibility
假说梳理	Hypothesis mapping
假说节点	Hypothesis nodes
充分	Sufficient
公开	Public
公开 · 已注册并登录的 BREVESS 用户	Public · Registered, signed-in BREVESS users
公开备注也仅向已注册并登录的 BREVESS 用户提供。	Public notes are available only to registered, signed-in BREVESS users.
共享中心	Sharing center
共享到课题组	Share with group
共享操作未完成	Sharing did not complete
共享服务地址无效	Invalid sharing service address
共享服务没有返回有效版本	The sharing service did not return a valid revision
共享服务返回无效响应	Invalid response from the sharing service
共享服务返回无效登录信息	Invalid sign-in response from the sharing service
共享服务通信失败	Sharing service communication failed
共享期间账号已变化，请重新核验服务结果。	The account changed during sharing. Check the service result again.
共享阅读	Shared reading
共享阅读内容不持久缓存。离开页面、切换账号或权限复核失败时会清空显示；已经阅读或复制的信息无法从对方记忆或设备收回。	Shared content is not retained offline. Leaving the page, switching accounts or failing a permission check clears the display. Content already read or copied cannot be recalled.
关系	Relationship
关系与人工判断	Relationships and authored assessments
关联条目	Linked item
关键读出	Key readout
关闭可见性设置	Close visibility settings
关闭读者笔记	Close reader notes
内容	Content
内容保留在本机，此操作不会上传。	Content stays on this device. Nothing is uploaded.
写下你的理解、疑问或补充…	Share your understanding, question or addition…
写下对这个 Panel 的理解、问题或补充…	Share your understanding, question or addition about this Panel…
分享链接（登录后阅读）↗	Share link (sign-in required) ↗
分支	Branch
列表按当前账号实时鉴权；公开备注也需要注册并登录后阅读。原内容只由作者修改；打开讨论可评论与点赞，不会覆盖你的本地笔记。	Access is checked for the current account. Public notes also require registration and sign-in. Only authors edit original content. Open a discussion to comment and like; your local notes remain unchanged.
创建课题组	Create group
删除我的评论	Delete my comment
刷新权限	Refresh access
刷新访问权限	Refresh access permissions
前文定位	Preceding anchor text
原备注已更新，请刷新并确认内容后重新评论。	The original note changed. Refresh and review it before commenting again.
原备注点赞	Like original note
取消原备注点赞	Unlike original note
原备注版本未确认，请刷新后评论。	The note revision is not confirmed. Refresh before commenting.
参考用途	Reference use
反馈	Feedback
发布首条评论	Publish first comment
发表对这条备注的评论	Comment on this note
发起新的 Panel 讨论	Start another Panel discussion
发起这个 Panel 的讨论	Start a discussion on this Panel
发送范围	Audience
发送评论	Post comment
发送邀请	Send invitation
受权限保护	Access restricted
受权限保护的条目链接 ↗	Restricted item link ↗
只有作者可以撤回这条讨论。	Only the author can withdraw this discussion.
只读预览	Read-only preview
可见性已在其他窗口更改，请重新打开预览	Visibility changed in another window. Reopen the preview
可见范围	Visibility
可阅读的共享内容	Shared content you can read
后文定位	Following anchor text
围绕同一来源交流。评论继承原备注的可见范围；备注撤销共享或成员离组后，评论访问也随之撤销。	Discuss the same source. Comments inherit the original note's visibility. Withdrawing a note or leaving a group also revokes comment access.
在线来源	Online source
备注讨论	Note discussion
完成	Done
定位到原文	Locate in source
定位短引文	Anchor quote
实际将发送的内容 · 请逐项检查	Content to be sent · Review each item
实验与比较组	Experiments and comparison groups
实验状态	Experiment status
密码	Password
对方用户名	Invitee username
尚无人工说明	No authored description yet
尚无说明	No description yet
尚未登录。选择共享前，请打开共享中心登录，然后重新打开此预览。	Not signed in. Sign in through the sharing center, then reopen this preview before sharing.
已仅个人可见。	This is now private.
已从服务重新核验访问权限。	Access permissions checked with the service.
已保持仅个人可见，未上传。	Kept private. Nothing was uploaded.
已加入课题组。	Joined the group.
已在当前测试服务注册并登录。	Registered and signed in to the current test service.
已撤回，当前仅个人可见。	Withdrawn. Now private.
已有结果	Results available
已退出课题组；访问权限已更新。	Left the group. Access permissions updated.
当前 Panel 来源未确认，请重新打开评论入口。	The current Panel source is not confirmed. Reopen the discussion.
当前内容检测未通过，可选择“仅个人可见”撤销已有共享。	The content check failed. Select Private to withdraw existing sharing.
当前有权阅读的关联条目	Linked items you can currently read
当前服务权限未确认，请关闭后重试；本机内容未变。	Service access is not confirmed. Close and retry. Local content is unchanged.
当前本机内容不能共享	This local content cannot be shared
当前来源已变化，请重新打开评论入口。	The current source changed. Reopen the discussion.
待确定条件	Conditions to determine
必要	Necessary
成员已移出；服务已撤销其组内读取权限。	Member removed. The service revoked their group access.
我的	Mine
我的课题组	My groups
所有	All
所有已注册并登录 BREVESS 的用户可检索与阅读此条备注；未登录访客不能阅读。	All registered, signed-in BREVESS users can search and read this note. Visitors who are not signed in cannot read it.
所有已登录用户的公开讨论	Public discussions by all signed-in users
所有当前可读的作者	All currently accessible authors
打开同一讨论界面发表评论、点赞或取消赞，并按点赞最多、最新或最早排序。	Open this discussion to comment, like or unlike, and sort by most liked, newest or oldest.
打开在线来源 ↗	Open online source ↗
拒绝	Decline
接受邀请	Accept invitation
接口路径无效	Invalid API path
撤回此讨论	Withdraw discussion
撤回此讨论 / 备注共享	Withdraw this discussion / shared note
操作未完成	The operation did not complete
改为仅个人可见，同时撤销他人对后续评论的访问	Make private and revoke others' access to subsequent comments
文本	Text
文档版本	Document version
文档版本标识	Document version identifier
新课题组名称	New group name
无法连接共享服务；本次变更未确认生效。本机内容仍保留。	Cannot connect to the sharing service. This change is not confirmed. Local content is preserved.
暂无可阅读的匹配内容。	No matching readable content.
最新	Newest
最早	Oldest
服务地址	Service address
服务已处理此操作，但本机共享映射未能确认。请在原账号的共享中心核验结果，勿重复发布。	The service processed the operation, but its local sharing reference could not be confirmed. Check the result in the original account's sharing center before publishing again.
服务未返回有效点赞确认，请刷新后查看。	The service did not confirm the like. Refresh to check.
服务确认后立即停止公开和课题组访问。	Public and group access stops as soon as the service confirms.
未命名 Panel	Untitled Panel
未命名条目	Untitled item
未命名节点	Untitled node
未命名证据块	Untitled evidence block
本次可见性变更未确认生效。	This visibility change is not confirmed.
条件	Conditions
来源定位	Source location
检索备注、假说与组图	Search notes, hypotheses and figure plans
正在核验当前账号、原文来源与评论权限…	Checking the account, source and discussion permissions…
正在等待共享服务确认…	Waiting for the sharing service to confirm…
正在读取账号与当前权限…	Loading the account and access permissions…
此入口仅支持原文备注与 Panel 笔记	This entry supports article and Panel notes only
此分享链接需要登录后阅读。登录后将自动打开目标条目。	Sign in to read this shared link. The item will open after sign-in.
此处注册的是当前独立测试服务的 BREVESS 账号。使用浏览器打开时，刷新页面后需重新登录。	Registration creates a BREVESS account on this independent test service. In browser mode, sign in again after refreshing the page.
此条内容的可见性	Visibility of this item
此类型不支持所选可见性	This visibility is not supported for this content type
段落	Paragraph
段落标识	Paragraph identifier
注册 / 登录与课题组管理 ↗	Register / sign in and manage groups ↗
注册测试账号	Register test account
点赞最多	Most liked
用户名	Username
登录	Sign in
登录结果已过期，请重新登录。	The sign-in result expired. Sign in again.
相关	Correlation
相反结果：是	Contradictory result: yes
移出	Remove
笔记与评论排序	Sort notes and comments
笔记可见范围	Note visibility
筛选笔记与评论作者范围	Filter note and comment authors
组图规划	Figure planning
结束位置	End offset
缺少稳定的来源身份，不能共享此条记录	A stable source identity is missing. This record cannot be shared
节点	Node
节点间的关系	Relationships between nodes
计划论断	Planned claim
讨论已更新。	Discussion updated.
讨论排序	Discussion order
讨论来源已变化，请重新打开该条目。	The discussion source changed. Reopen this item.
讨论版本未确认，请刷新后再操作。	The discussion revision is not confirmed. Refresh before continuing.
论证目标	Argument goal
证据块	Evidence blocks
评论点赞	Like comment
取消评论点赞	Unlike comment
评论需为 1–4000 字符，不能只有空白。	A comment must contain 1–4,000 characters and cannot be blank.
请亲自点击保存可见性。	Click Save visibility yourself to confirm.
请先注册并登录 BREVESS 账号，再查看或参与讨论。	Register and sign in to BREVESS before reading or joining discussions.
请先注册并登录 BREVESS 账号，再查看读者笔记。	Register and sign in to BREVESS before reading reader notes.
请先登录共享账号	Sign in to your sharing account first
请先登录后发表评论。	Sign in before posting a comment.
请先登录，或在当前测试服务注册账号。	Sign in, or register an account on the current test service.
请明确选择公开或一个课题组。	Choose Public or a specific group.
请注册并登录 BREVESS 账号后阅读共享内容	Register and sign in to BREVESS to read shared content
请登录后点赞。	Sign in before liking.
请输入 HTTPS 服务 origin，或本机 HTTP 测试服务 origin	Enter an HTTPS service origin or a local HTTP test service origin
请选择有效排序方式。	Choose a valid sort order.
请选择课题组	Select a group
读者笔记与评论列表	Reader notes and comments
课题组	Research group
课题组内共享	Group
课题组已创建。	Group created.
账号、课题组与共享中心 ↗	Accounts, groups and sharing center ↗
账号与服务	Account and service
账号已切换，请刷新当前读者笔记。	The account changed. Refresh the reader notes.
账号已变化，请刷新访问权限。	The account changed. Refresh access permissions.
账号或共享服务已切换，请重新打开预览。	The account or sharing service changed. Reopen the preview.
账号或共享服务已变化，过期请求的结果已丢弃，请重新操作。	The account or sharing service changed. The stale result was discarded. Try again.
账号或服务已切换，请关闭后重新打开预览。	The account or service changed. Close and reopen the preview.
输入标题或人工备注中的关键词	Enter keywords from a title or authored note
还没有评论，可以从这条备注开始讨论。	No comments yet. Start a discussion on this note.
这是你的 Panel 在线备注或讨论。撤回后仅你自己可读，其他人的后续评论也不再对外开放；本机 Panel 笔记保持原样。	This is your online Panel note or discussion. Withdrawal makes it private, including subsequent comments. Your local Panel note remains unchanged.
这是独立的在线讨论，不会改写你的本机 Panel 笔记。	This is a separate online discussion. It does not change your local Panel note.
这里暂时没有此范围内可阅读的笔记。	There are no readable notes in this scope yet.
这里的读者笔记与讨论	Reader notes and discussions here
连接此服务	Connect to this service
退出登录	Sign out
退出课题组	Leave group
选择课题组	Select group
逐条选择可见范围，让讨论有边界。作者保留编辑权；组内成员可以阅读。已注册并登录的 BREVESS 用户可检索公开备注，也可登录后打开分享链接。	Choose an audience for each item. Authors retain editing rights; group members can read. Registered, signed-in BREVESS users can search public notes and open shared links.
邀请已创建，等待对方接受。	Invitation created. Waiting for acceptance.
邀请成员（对方接受后生效）	Invite a member (effective after acceptance)
需登录	Sign-in required
页面离开后已清空共享笔记。	Shared notes were cleared when you left the page.
预期结果	Expected result
预览内容包含疑似本机路径或凭据，请在原记录中检查后重试。	The preview may contain a local path or credentials. Check the original record and retry.
首条评论	First comment
首条评论与后续回复仅作者和所选课题组当前成员可读。	Only the author and current members of the selected group can read the first comment and replies.
首条评论与后续回复向所有已注册并登录的 BREVESS 用户开放。	The first comment and replies are available to all registered, signed-in BREVESS users.
首条评论发送范围	First comment audience
首条评论课题组	First comment group
首条评论需为 1–4000 字符，不能只有空白。	The first comment must contain 1–4,000 characters and cannot be blank.
高亮备注	Highlight note
（空白备注）	(Empty note)
（空白笔记）	(Empty note)
未命名	Untitled
待核验	Awaiting verification
界面语言	Interface language
简体中文	Simplified Chinese
关闭	Close
取消	Cancel`.split('\n').map(line=>line.split('\t')));
  Object.assign(entries,{'· 管理员':'· Administrator','起始位置':'Start offset','结束位置':'End offset','实验分组表：':'Experimental groups:','证据分类：':'Evidence categories:','尚无说明':'No description yet','尚无人工说明':'No authored description yet','其他人的评论绑定原共享范围，无法扩大或更换受众；请为目标范围新建讨论。':'Other participants’ comments belong to the original audience. You cannot expand or change that audience; start a new discussion for the intended audience.'});
  entries['本句评论']='Discussion on this sentence';
  Object.assign(entries,Object.fromEntries(`公开备注分页无法完整加载，请缩小课题组筛选范围后重试。	Public notes could not be loaded completely. Narrow the research group filter and try again.
当前密码不正确，请重新登录后重试。	The current password is incorrect. Sign in again and retry.
登录已过期，请重新登录。	Your session has expired. Sign in again.
用户名不符合要求。	The username does not meet the requirements.
用户名为 3–64 位字母、数字、点、下划线或连字符，以字母或数字开头。	Use 3–64 letters, digits, dots, underscores or hyphens. Start with a letter or digit.
密码长度为 12–1024 个字符。	Use a password of 12–1024 characters.
分页结果无效，请刷新后重试。	The page response is invalid. Refresh and try again.
BREVESS 账号	BREVESS account
服务连接	Service connection
正在确认账号服务…	Checking the account service…
账号操作	Account actions
创建账号	Create account
创建 BREVESS 账号	Create a BREVESS account
邮箱	Email
确认密码	Confirm password
注册后请查收邮件，验证邮箱后即可登录。	Check your email after registration. Verify your email address before signing in.
忘记密码？	Forgot password?
找回密码	Recover password
输入注册邮箱，我们会向符合条件的账号发送重置密码邮件。	Enter your account email. We will send a reset email if the account is eligible.
发送重置邮件	Send reset email
返回登录	Back to sign in
重新发送验证邮件	Resend verification email
发送验证邮件	Send verification email
未收到验证邮件？	Verification email missing?
验证邮箱	Verify email
点击下方按钮确认邮箱。打开此页面不会自动使用验证链接。	Select the button below to verify your email. Opening this page does not use the verification link.
确认验证邮箱	Verify my email
设置新密码	Set a new password
重置密码后，所有设备都需要重新登录。	After resetting your password, sign in again on all devices.
新密码	New password
确认新密码	Confirm new password
重置密码	Reset password
返回账号	Back to account
绑定或更新邮箱	Add or update email
当前密码	Current password
验证成功后才会更新账号邮箱，可用于找回密码。	Your account email changes only after verification. It can then be used to recover your password.
发送邮箱验证	Send email verification
修改密码	Change password
修改密码后，所有设备都需要重新登录。	After changing your password, sign in again on all devices.
更新密码并退出	Update password and sign out
加载更多共享内容	Load more shared content
请先验证邮箱，再登录账号。	Verify your email before signing in.
此链接已失效、已使用或已过期，请重新申请邮件。	This link is invalid, used or expired. Request a new email.
请输入有效的邮箱地址。	Enter a valid email address.
邮件暂时无法发送，请稍后重试。	Email is temporarily unavailable. Try again later.
此用户名暂不可用，请换一个。	This username is unavailable. Choose another.
此邮箱暂不可用，请使用其他邮箱或找回原账号。	This email is unavailable. Use another email or recover your existing account.
用户名或密码不正确。	The username or password is incorrect.
密码不符合要求，请检查后重试。	The password does not meet the requirements. Check it and try again.
当前服务暂未开放注册。	Registration is not currently available on this service.
操作过于频繁，请稍后重试。	Too many attempts. Try again later.
当前服务使用本机账号，可注册后直接登录。	This service uses local accounts. You can sign in immediately after registration.
邮箱已验证	Email verified
邮箱尚未验证	Email not yet verified
请绑定邮箱，以便找回密码。	Add an email address for password recovery.
两次输入的密码不一致。	The passwords do not match.
账号由当前 BREVESS 云服务管理。	Your account is managed by this BREVESS cloud service.
当前为本机兼容服务，不支持邮件验证或密码找回。	This is a legacy local service. Email verification and password recovery are not available.
无法确认账号服务，请检查连接后刷新。	The account service could not be checked. Check the connection and refresh.
请登录 BREVESS 账号后继续。	Sign in to your BREVESS account to continue.
账号已创建，请查收验证邮件。验证完成后再登录。	Account created. Check your verification email, then sign in after verifying.
账号已创建并登录。	Your account has been created and signed in.
如果该邮箱符合条件，我们已发送邮件。请检查收件箱与垃圾邮件。	If the email is eligible, we have sent a message. Check your inbox and spam folder.
邮箱已验证。请登录 BREVESS 账号。	Email verified. Sign in to your BREVESS account.
密码已更新，所有会话已退出。请使用新密码登录。	Password updated and all sessions signed out. Sign in with your new password.
请查收验证邮件。验证成功前，原账号邮箱保持不变。	Check your verification email. Your current account email stays unchanged until verification.
加载更多笔记	Load more notes
加载更多评论	Load more comments
正在加载更多…	Loading more…
还有更多结果，可继续加载。	More results are available. Load more to continue.
当前检索仅筛选已加载内容。	Search currently filters the loaded content.
`.trim().split('\n').map(line=>line.split('\t'))));
  const t=value=>globalThis.SciLLM?.translateInterfaceText?.(value,'en')||entries[value]||value;
  const patterns=[
    [/^(.+) · Panel (.+) 评论$/u,m=>m[1]+' · Panel '+m[2]+' discussion'],
    [/^发表于 (.+)$/u,m=>'Posted '+m[1]],
    [/^(已赞|赞) (\d+)$/u,m=>(m[1]==='已赞'?'Liked':'Like')+' '+m[2]],
    [/^评论交流 · (\d+)$/u,m=>'Discussion · '+m[1]],
    [/^参与讨论 · (\d+) 条回复 · (\d+) 赞$/u,m=>`Join discussion · ${m[1]} replies · ${m[2]} likes`],
    [/^(\d+) 条$/u,m=>m[1]+' items'],
    [/^版本 (\d+)$/u,m=>'Revision '+m[1]],
    [/^关联已发布资源：(\d+) 条（阅读时逐条鉴权）$/u,m=>`Published links: ${m[1]} (access checked individually)`],
    [/^(.+) · (\d+) 条当前可读笔记( · 仅显示所选课题组当前成员的笔记与评论)?$/u,m=>`${m[1]} · ${m[2]} readable notes${m[3]?' · Current members of the selected group only':''}`],
    [/^来源：Figure (.+) · Panel (.+)$/u,m=>`Source: Figure ${m[1]} · Panel ${m[2]}`],
    [/^与原备注同范围：(.+) · 仅登录后可交流$/u,m=>`Same audience as the note: ${t(m[1])} · Sign-in required`],
    [/^对 (.+) 的备注发表评论$/u,m=>'Comment on the note by '+m[1]],
    [/^邀请到(.+)的用户名$/u,m=>'Username to invite to '+m[1]],
    [/^只看课题组成员：(.+)$/u,m=>'Group members only: '+m[1]],
    [/^邀请加入：(.+)$/u,m=>'Invitation to join: '+m[1]],
    [/^已登录：(.+)$/u,m=>'Signed in: '+m[1]],
    [/^账号：(.+)$/u,m=>'Account: '+m[1]],
    [/^(.+) · 管理员$/u,m=>m[1]+' · Administrator'],
    [/^(高亮备注|Panel 笔记|假说梳理|组图规划) · (仅个人可见|课题组内共享|公开)( · 我的内容| · 只读)?$/u,m=>`${t(m[1])} · ${t(m[2])}${m[3]===' · 我的内容'?' · My content':m[3]?' · Read-only':''}`],
    [/^(DOI|Figure|Panel|段落|高亮备注)：(.+)$/u,m=>t(m[1])+': '+m[2]],
    [/^对应 Panel：(.+)$/u,m=>'Linked Panels: '+m[1]],
    [/^服务已确认：(.+)$/u,m=>'Service confirmed: '+t(m[1])],
    [/^(.+) 本次可见性变更未确认生效。$/u,m=>t(m[1])+' This visibility change is not confirmed.'],
    [/^(.+) 当前服务权限未确认，请关闭后重试；本机内容未变。$/u,m=>t(m[1])+' Service access is not confirmed. Close and retry; local content is unchanged.']
  ];
  for(const [prefix,en]of [['共享内容已清空：','Shared content cleared: '],['无法定位或权限已变化：','Cannot locate the source or permissions changed: '],['此条目不存在或当前无权阅读：','This item does not exist or access is denied: '],['评论操作未确认，内容已清空以重新核验权限：','The comment action was not confirmed. Content was cleared for a new access check: '],['已清除本机会话；远程退出未确认：','Local session cleared; remote sign-out unconfirmed: ']])patterns.push([new RegExp('^'+prefix+'(.+)$','u'),m=>en+t(m[1])]);
  return {entries,patterns};
});
