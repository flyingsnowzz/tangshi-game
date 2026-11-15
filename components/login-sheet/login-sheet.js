/** 保存成绩时唤起的登录弹层：只负责展示，登录动作交给官方 login-panel */
Component({
    properties: {
        open: { type: Boolean, value: false },
    },
    methods: {
        noop: function () {},
        onClose: function () {
            this.triggerEvent('close');
        },
        onSignedIn: function () {
            this.triggerEvent('signedin');
        },
    },
});
