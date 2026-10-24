package jp.streamtorearn.stackinggame.event;

/** BridgeMOD のゲームAPI応答と同じ意味を持つ受付結果。 */
public enum SubmitStatus {
    /** 一時的に受け入れられない。Bridge 側で同じ要求を保持してもらう。 */
    WAIT(0),
    /** ゲームMODの待機列へ引き受けた、または同じ requestId を既に引き受け済み。 */
    ACCEPTED(1),
    /** 古いゲーム番号や不正要求など。再送しても受け入れない。 */
    DISCARDED(2);

    private final int bridgeCode;

    SubmitStatus(int bridgeCode) {
        this.bridgeCode = bridgeCode;
    }

    public int bridgeCode() {
        return bridgeCode;
    }
}
