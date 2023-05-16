module.exports = function(RED) {
    function WorxAccount(n) {
        RED.nodes.createNode(this,n);
        this.mail = n.mail;
        this.password = n.password;
    }
    RED.nodes.registerType("worx-account",WorxAccount);
}